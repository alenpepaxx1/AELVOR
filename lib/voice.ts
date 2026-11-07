// Copyright © 2026 Alen Pepa
import type { Locale } from "./templates.ts";
import { codeFences } from "./code-fences.ts";

type SpeechOutputSource = Pick<SpeechSynthesis, "getVoices" | "speak" | "cancel"> & Partial<Pick<SpeechSynthesis, "addEventListener" | "removeEventListener">>;
export type SpeechOutput = { speak: (utterance: SpeechSynthesisUtterance) => void; cancel: () => void; dispose: () => void };

// Speech is optional. A denied getter, failed voice enumeration or failed
// cancellation must not prevent opening or navigating the text workspace.
export function connectSpeechOutput(getSource: () => SpeechOutputSource | null | undefined, onVoices: (voices: SpeechSynthesisVoice[]) => void): SpeechOutput | null {
  let source: SpeechOutputSource;
  try {
    const value = getSource();
    if (!value || typeof value.speak !== "function" || typeof value.cancel !== "function" || typeof value.getVoices !== "function") return null;
    source = value;
  } catch { return null; }
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    let voices: SpeechSynthesisVoice[] = [];
    try { const available = source.getVoices(); if (Array.isArray(available)) voices = available; } catch { /* The browser's default voice can still work. */ }
    onVoices(voices);
  };
  const cancel = () => { try { source.cancel(); } catch { /* Optional browser service; text remains available. */ } };
  refresh();
  try { source.addEventListener?.("voiceschanged", refresh); } catch { /* Initial voices/default voice remain usable. */ }
  return {
    speak: utterance => { if (disposed) throw new Error("speech_output_disposed"); source.speak(utterance); },
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { source.removeEventListener?.("voiceschanged", refresh); } catch { /* Cleanup cannot block navigation. */ }
      cancel();
    },
  };
}

export type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type Callbacks = { onListening: (value: boolean) => void; onTranscript: (value: string) => void; onComplete: (value: string) => void; onError: (code: string) => void };

export function recognitionFactory(getScope: () => unknown): (() => Recognition) | null {
  let scope: unknown; try { scope = getScope(); } catch { return null; }
  if (!scope || typeof scope !== "object") return null;
  for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
    try {
      const Constructor = (scope as Record<string, unknown>)[name];
      if (typeof Constructor === "function") return () => new (Constructor as new () => Recognition)();
    } catch { /* A denied standard API must not hide a usable prefixed API. */ }
  }
  return null;
}

export class RecognitionSession {
  private active: { recognition: Recognition; callbacks: Callbacks } | null = null;
  get running() { return this.active !== null; }
  start(create: () => Recognition, locale: Locale, callbacks: Callbacks) {
    if (this.active) { this.stop(); return; }
    let recognition: Recognition;
    try { recognition = create(); } catch { callbacks.onError("start_failed"); return; }
    const session = { recognition, callbacks }; this.active = session;
    const current = () => this.active === session;
    let transcript = "";
    try {
      recognition.lang = locale === "de" ? "de-DE" : "en-US";
      recognition.continuous = false; recognition.interimResults = true;
      recognition.onstart = () => { if (current()) callbacks.onListening(true); };
      recognition.onresult = event => {
        if (!current()) return;
        transcript = Array.from(event.results).map(result => result[0].transcript).join(" ");
        callbacks.onTranscript(transcript);
      };
      recognition.onerror = event => {
        if (!current()) return;
        this.active = null; callbacks.onListening(false); callbacks.onError(event.error);
      };
      recognition.onend = () => {
        if (!current()) return;
        this.active = null; callbacks.onListening(false);
        if (transcript.trim()) callbacks.onComplete(transcript.trim());
      };
      callbacks.onListening(true);
      if (current()) recognition.start();
    } catch {
      if (current()) {
        this.active = null;
        try { recognition.abort(); } catch { /* A partially configured service may already be closed. */ }
        callbacks.onListening(false); callbacks.onError("start_failed");
      }
    }
  }
  stop() {
    if (!this.active) return;
    try { this.active.recognition.stop(); } catch { this.cancel(); }
  }
  cancel() {
    const session = this.active; this.active = null;
    if (session) { try { session.recognition.abort(); } catch { /* Some browsers already ended the recognition. */ } session.callbacks.onListening(false); }
  }
}

export function speechChunks(text: string, locale: Locale): string[] {
  let withoutCode = "", cursor = 0;
  for (const fence of codeFences(text)) { withoutCode += text.slice(cursor, fence.start) + (locale === "de" ? " Codeblock ausgelassen. " : " Code block omitted. "); cursor = fence.end; }
  withoutCode += text.slice(cursor);
  const cleaned = withoutCode.replace(/[#*`>|]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  let end = Math.min(8000, cleaned.length);
  if (/[\uD800-\uDBFF]/.test(cleaned[end - 1] || "") && /[\uDC00-\uDFFF]/.test(cleaned[end] || "")) end--;
  const plain = cleaned.slice(0, end);
  const chunks: string[] = [];
  for (const sentence of plain.match(/[^.!?\n]+[.!?]?/g) || []) {
    let current = "";
    for (const word of sentence.trim().split(/\s+/)) {
      const letters = Array.from(word);
      if (word.length > 220) {
        if (current) { chunks.push(current); current = ""; }
        let fragment = "";
        for (const letter of letters) { if (fragment.length + letter.length > 220) { chunks.push(fragment); fragment = ""; } fragment += letter; }
        if (fragment) chunks.push(fragment);
      } else if (current && current.length + word.length + 1 > 220) { chunks.push(current); current = word; }
      else current += `${current ? " " : ""}${word}`;
    }
    if (current.trim()) chunks.push(current);
  }
  return chunks;
}
