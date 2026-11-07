// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { connectSpeechOutput, recognitionFactory, RecognitionSession, speechChunks } from "../lib/voice.ts";

test("missing or denied speech output is optional and does not prevent text startup", () => {
  assert.equal(connectSpeechOutput(() => { throw new Error("Speech service denied"); }, () => {}), null);
  assert.equal(connectSpeechOutput(() => undefined, () => {}), null);
  assert.equal(connectSpeechOutput(() => ({ speak() {} }), () => {}), null);
});

test("voice enumeration updates, playback and cleanup share one source and ignore late events", () => {
  const updates = [], spoken = []; let listener, removed, cancels = 0, voices = [];
  const source = { getVoices: () => voices, speak: utterance => spoken.push(utterance), cancel() { cancels++; }, addEventListener(event, callback) { assert.equal(event, "voiceschanged"); listener = callback; }, removeEventListener(event, callback) { removed = callback; } };
  const output = connectSpeechOutput(() => source, value => updates.push(value));
  assert.deepEqual(updates, [[]]);
  voices = [{ voiceURI: "voice-de", name: "German", lang: "de-DE" }]; listener();
  assert.equal(updates.at(-1)[0].lang, "de-DE");
  const utterance = { text: "Hallo" }; output.speak(utterance); assert.equal(spoken[0], utterance);
  output.dispose(); output.dispose(); assert.equal(removed, listener); assert.equal(cancels, 1);
  const count = updates.length; listener(); assert.equal(updates.length, count);
  assert.throws(() => output.speak(utterance), /speech_output_disposed/);
});

test("failed enumeration and browser cancellation do not block navigation or default-voice playback", () => {
  let voices, spoken = 0;
  const output = connectSpeechOutput(() => ({ getVoices() { throw Error("Enumeration denied"); }, speak() { spoken++; }, cancel() { throw Error("Already stopped"); }, addEventListener() { throw Error("Events denied"); }, removeEventListener() { throw Error("Events denied"); } }), value => { voices = value; });
  assert.deepEqual(voices, []); output.speak({ text: "Hello" }); assert.equal(spoken, 1);
  assert.doesNotThrow(() => output.cancel()); assert.doesNotThrow(() => output.dispose());
});

test("a playback failure reaches the caller's localized error boundary instead of pretending it spoke", () => {
  const output = connectSpeechOutput(() => ({ getVoices: () => [], speak() { throw Error("Audio unavailable"); }, cancel() {} }), () => {});
  assert.throws(() => output.speak({ text: "Hello" }), /Audio unavailable/); output.dispose();
});

function fixture() {
  const devices = [], transcripts = [], sent = [], errors = [], listening = [];
  const create = () => { const device = { start() {}, stop() { this.stopped = true; }, abort() { this.aborted = true; } }; devices.push(device); return device; };
  const callbacks = { onListening: value => listening.push(value), onTranscript: value => transcripts.push(value), onComplete: value => sent.push(value), onError: code => errors.push(code) };
  return { devices, transcripts, sent, errors, listening, create, callbacks };
}
const transcript = value => ({ results: [{ isFinal: true, 0: { transcript: value } }] });

test("normal voice completion produces one transcript in the configured language", () => {
  const f = fixture(), session = new RecognitionSession();
  session.start(f.create, "de", f.callbacks);
  assert.equal(f.devices[0].lang, "de-DE");
  f.devices[0].onresult(transcript("Hallo Welt")); session.stop(); f.devices[0].onend();
  assert.deepEqual(f.sent, ["Hallo Welt"]);
  assert.equal(session.running, false);
  assert.equal(f.devices[0].stopped, true);
});

test("late callbacks from a cancelled recording cannot send into another chat or replace a new transcript", () => {
  const f = fixture(), session = new RecognitionSession();
  session.start(f.create, "en", f.callbacks);
  const old = f.devices[0]; old.onresult(transcript("Old question"));
  session.cancel(); session.start(f.create, "de", f.callbacks);
  old.onstart(); old.onresult(transcript("Late old question")); old.onend(); old.onerror({ error: "not-allowed" });
  assert.deepEqual(f.transcripts, ["Old question"]); assert.deepEqual(f.sent, []); assert.deepEqual(f.errors, []);
  assert.equal(session.running, true); assert.equal(old.aborted, true);
  f.devices[1].onresult(transcript("Neue Frage")); f.devices[1].onend();
  assert.deepEqual(f.sent, ["Neue Frage"]);
});

test("repeated microphone clicks before onstart do not create overlapping recognizers", () => {
  const f = fixture(), session = new RecognitionSession();
  session.start(f.create, "en", f.callbacks); session.start(f.create, "en", f.callbacks);
  assert.equal(f.devices.length, 1); assert.equal(f.devices[0].stopped, true);
  session.cancel();
});

test("recognition errors never auto-send an interim transcript or leave the UI listening", () => {
  const f = fixture(), session = new RecognitionSession();
  session.start(f.create, "en", f.callbacks); f.devices[0].onresult(transcript("unfinished"));
  f.devices[0].onerror({ error: "not-allowed" }); f.devices[0].onend();
  assert.equal(session.running, false); assert.deepEqual(f.sent, []); assert.deepEqual(f.errors, ["not-allowed"]);
  assert.equal(f.listening.at(-1), false);
});

test("a failed recognition start is recoverable with a new recording", () => {
  const f = fixture(), session = new RecognitionSession();
  session.start(() => ({ ...f.create(), start() { throw Error("busy"); } }), "en", f.callbacks);
  assert.equal(session.running, false); assert.deepEqual(f.errors, ["start_failed"]);
  session.start(f.create, "en", f.callbacks); assert.equal(session.running, true); session.cancel();
});

test("spoken chunks exclude code, never contain empty chunks and split long unbroken text", () => {
  const chunks = speechChunks("Hallo.\n```python\nsecret_in_code = 123\n```\n" + "a".repeat(500), "de");
  assert.ok(chunks.every(value => value.trim().length > 0));
  assert.ok(chunks.every(value => value.length <= 220));
  assert.ok(!chunks.join(" ").includes("secret_in_code"));
  assert.match(chunks.join(" "), /Codeblock ausgelassen/);
  assert.equal(speechChunks("   \n", "en").length, 0);
});

test("denied speech constructors stay optional and a usable legacy constructor is retained", () => {
  assert.equal(recognitionFactory(() => { throw Error("denied"); }), null);
  assert.equal(recognitionFactory(() => null), null);
  assert.equal(recognitionFactory(() => ({ get SpeechRecognition() { throw Error("denied"); } })), null);
  let created = 0;
  class Legacy { constructor() { created++; } }
  const create = recognitionFactory(() => ({ get SpeechRecognition() { throw Error("denied"); }, webkitSpeechRecognition: Legacy }));
  assert.equal(created, 0); assert.ok(create() instanceof Legacy); assert.equal(created, 1);
  assert.equal(recognitionFactory(() => ({ SpeechRecognition: 1, webkitSpeechRecognition: null })), null);
});

test("failed recognition configuration releases the service, clears state and allows a retry", () => {
  for (const property of ["lang", "continuous", "interimResults", "onresult"]) {
    const f = fixture(), session = new RecognitionSession(); let aborted = 0, started = 0;
    const device = { abort() { aborted++; }, start() { started++; } };
    Object.defineProperty(device, property, { set() { throw Error("denied configuration"); } });
    assert.doesNotThrow(() => session.start(() => device, "en", f.callbacks));
    assert.equal(session.running, false); assert.equal(started, 0); assert.equal(aborted, 1); assert.deepEqual(f.errors, ["start_failed"]); assert.equal(f.listening.at(-1), false);
    session.start(f.create, "de", f.callbacks); assert.equal(session.running, true); session.cancel();
  }
});

test("a partially started recognizer is aborted and late events cannot send text", () => {
  const f = fixture(), session = new RecognitionSession(); let device;
  session.start(() => (device = { ...f.create(), start() { this.onresult(transcript("Partial question")); throw Error("start failed"); } }), "en", f.callbacks);
  assert.equal(session.running, false); assert.equal(device.aborted, true); device.onend();
  assert.deepEqual(f.sent, []); assert.equal(f.listening.at(-1), false);
});

test("emoji and long Unicode words produce nonempty bounded chunks without splitting surrogate pairs", () => {
  for (const text of ["😀".repeat(150), "a" + "😀".repeat(5000), "Words " + "𐐀".repeat(220) + " end.", "a ".repeat(110) + "😀".repeat(110)]) {
    const chunks = speechChunks(text, "en"); assert.ok(chunks.length > 0);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 220 && chunk.isWellFormed()));
    assert.equal(chunks.join("").replace(/\s/g, ""), text.slice(0, text.startsWith("a😀") ? 7999 : 8000).replace(/\s/g, ""));
  }
});

test("speech omits whole long and unclosed fences, including shorter Markdown examples inside", () => {
  for (const closing of ["````\nAfter.", ""]) {
    const text = "Before.\n````markdown\nInner documentation.\n```python\nsecret_code()\n```\nSECRET_AFTER_INNER_FENCE\n" + closing;
    const spoken = speechChunks(text, "en").join(" ");
    assert.match(spoken, /Before/); assert.match(spoken, /Code block omitted/); assert.doesNotMatch(spoken, /Inner|secret_code|SECRET/);
    if (closing) assert.match(spoken, /After/);
  }
});
