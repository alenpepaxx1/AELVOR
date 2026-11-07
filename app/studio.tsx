"use client";
// Copyright © 2026 Alen Pepa

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Copy, Download, FileCode2, FileText, Fingerprint, FlaskConical, Hash, Link2, Loader2, Play, ScanLine, ShieldCheck, Upload, X } from "lucide-react";
import { extractIndicators, formatJson, hashSha256, inspectUrl, type Artifact, type Indicators, type UrlInspection, type UrlSignal } from "../lib/local-tools";
import type { Locale } from "../lib/templates";
import Markdown, { downloadText } from "./markdown";
import ModelLab from "./model-lab";
import type { ModelBundle } from "../lib/local-model";
import ArtifactWorkbench from "./artifact-workbench";
import { previewable } from "../lib/artifact-project";

export type StudioTab = "tools" | "artifacts" | "activity" | "model";
type Tool = "url" | "ioc" | "json" | "hash";
type RunResult = { tool: Tool; url?: UrlInspection; indicators?: Indicators; output?: string; filename?: string };
type Run = { id: number; tool: Tool; time: number; success: boolean; result?: RunResult; error?: string };

const samples: Record<Tool, string> = {
  url: "http://login.example.com@192.0.2.10/verify?redirect=https%3A%2F%2Fexample.org%2Fsignin",
  ioc: "2026-10-30T10:14:02Z src=192.0.2.24 dst=198.51.100.8\nrequest=https://example.org/login\ncontact=security@example.org\n2026-10-30T10:14:08Z src=192.0.2.24 action=blocked",
  json: '{"event":"sign_in","user":{"name":"analyst","mfa":true},"source_ip":"192.0.2.24","status":"success"}',
  hash: "Hello, AELVOR.",
};

export default function Studio({ tab, onTabChange, onClose, locale, artifacts, selected, onSelect, onNotice, modelBundle, onModelChange, active = true, artifactIntent = "code", artifactRequest = 0 }: { tab: StudioTab; onTabChange: (tab: StudioTab) => void; onClose: () => void; locale: Locale; artifacts: Artifact[]; selected: string | null; onSelect: (id: string | null) => void; onNotice: (text: string) => void; modelBundle: ModelBundle | null; onModelChange: (bundle: ModelBundle) => void; active?: boolean; artifactIntent?: "code" | "preview"; artifactRequest?: number }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [tool, setTool] = useState<Tool>("url");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const runSequence = useRef(0);
  const runningRef = useRef(false);
  const artifact = artifacts.find(item => item.id === selected);
  const names: Record<Tool, string> = { url: t("URL inspector", "URL-Inspektor"), ioc: t("Indicator extractor", "Indikator-Extraktor"), json: t("JSON formatter", "JSON-Formatierer"), hash: t("SHA-256 fingerprint", "SHA-256-Fingerabdruck") };
  const icons = { url: Link2, ioc: ScanLine, json: Braces, hash: Fingerprint };
  const descriptions: Record<Tool, string> = { url: t("Unpack a URL and surface details worth reviewing.", "Zerlege eine URL und prüfe auffällige Details."), ioc: t("Pull IP addresses, URLs, emails, and SHA-256 hashes from text.", "Extrahiere IP-Adressen, URLs, E-Mails und SHA-256-Hashes aus Text."), json: t("Validate and format a JSON payload in one click.", "Validiere und formatiere JSON mit einem Klick."), hash: t("Create a SHA-256 fingerprint of text or a local file.", "Erzeuge einen SHA-256-Fingerabdruck von Text oder einer lokalen Datei.") };
  const errors: Record<string, string> = {
    invalid_url: t("Enter a complete http:// or https:// URL.", "Gib eine vollständige http://- oder https://-URL ein."),
    too_long: t("Input is too large. Use a shorter excerpt.", "Die Eingabe ist zu groß. Nutze einen kürzeren Auszug."),
    invalid_json: t("This is not valid JSON. Check quotes, commas, and brackets.", "Dies ist kein gültiges JSON. Prüfe Anführungszeichen, Kommas und Klammern."),
    secure_context_required: t("SHA-256 requires HTTPS. Open the published workspace to use it.", "SHA-256 benötigt HTTPS. Nutze dafür den veröffentlichten Workspace."),
    file_too_large: t("Choose a file smaller than 20 MB.", "Wähle eine Datei kleiner als 20 MB."),
    unknown: t("The tool could not finish. Check the input and try again.", "Das Tool konnte nicht fertig werden. Prüfe die Eingabe und versuche es erneut."),
  };
  const signals: Record<UrlSignal, [string, string]> = {
    http: [t("Unencrypted connection", "Unverschlüsselte Verbindung"), t("HTTP does not encrypt traffic in transit.", "HTTP verschlüsselt die übertragenen Daten nicht.")],
    credentials: [t("Embedded credentials", "Eingebettete Zugangsdaten"), t("Text before @ is user information, not the destination host.", "Text vor @ sind Benutzerinformationen, nicht der Zielhost.")],
    ip: [t("IP address as host", "IP-Adresse als Host"), t("Check that this exact destination is expected.", "Prüfe, ob genau dieses Ziel erwartet wird.")],
    idn: [t("Internationalized hostname", "Internationalisierter Hostname"), t("Inspect the normalized hostname for lookalike characters.", "Prüfe den normalisierten Hostnamen auf ähnlich aussehende Zeichen.")],
    subdomains: [t("Multiple subdomains", "Mehrere Subdomains"), t("Read the complete hostname carefully.", "Lies den vollständigen Hostnamen sorgfältig.")],
    redirect: [t("External redirect parameter", "Externer Weiterleitungsparameter"), t("A query parameter points to another host.", "Ein Abfrageparameter verweist auf einen anderen Host.")],
    secret: [t("Sensitive parameter name", "Sensibler Parametername"), t("Credentials in URLs can leak through logs and browser history.", "Zugangsdaten in URLs können in Logs und im Browserverlauf landen.")],
  };

  useEffect(() => { setCopied(false); }, [selected, result]);
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { onNotice(t("Clipboard access is unavailable in this browser.", "Die Zwischenablage ist in diesem Browser nicht verfügbar.")); } }
  function changeTool(next: Tool) { setTool(next); setInput(""); setResult(null); setError(""); }
  async function run(file?: File) {
    if (runningRef.current || (tool !== "hash" && !input.trim() && !file)) return;
    runningRef.current = true;
    setRunning(true); setError(""); setResult(null);
    try {
      let value: RunResult;
      if (file) {
        if (file.size > 20_000_000) throw new Error("file_too_large");
        value = { tool: "hash", output: await hashSha256(await file.arrayBuffer()), filename: file.name };
      } else if (tool === "url") value = { tool, url: inspectUrl(input) };
      else if (tool === "ioc") value = { tool, indicators: extractIndicators(input) };
      else if (tool === "json") value = { tool, output: formatJson(input) };
      else value = { tool, output: await hashSha256(input) };
      const id = ++runSequence.current;
      setResult(value); setRuns(previous => [{ id, tool: value.tool, time: Date.now(), success: true, result: value }, ...previous].slice(0, 12));
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "unknown";
      const id = ++runSequence.current;
      setError(code); setRuns(previous => [{ id, tool, time: Date.now(), success: false, error: code }, ...previous].slice(0, 12));
    } finally { runningRef.current = false; setRunning(false); }
  }
  const reportText = result?.output || (result?.indicators ? JSON.stringify(result.indicators, null, 2) : result?.url ? JSON.stringify(result.url, null, 2) : "");
  const ToolIcon = icons[tool];

  return <aside className="studio-panel" aria-label={t("Studio panel", "Studio-Panel")}>
    <div className="studio-title"><span><span className="studio-mark"><FlaskConical size={16}/></span>AELVOR <strong>Studio</strong><span className="studio-version">03</span></span><button className="icon-button" onClick={onClose} aria-label={t("Close studio", "Studio schließen")}><X size={17}/></button></div>
    <div className="studio-tabs">{(["tools", "model", "artifacts", "activity"] as StudioTab[]).map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => onTabChange(item)}>{item === "tools" ? t("Tools", "Tools") : item === "model" ? t("Model lab", "Model-Lab") : item === "artifacts" ? t("Artifacts", "Artefakte") : t("Activity", "Aktivität")}{item === "artifacts" && artifacts.length > 0 && <span>{artifacts.length}</span>}</button>)}</div>
    <div className="studio-body">
      {tab === "model" && <ModelLab locale={locale} bundle={modelBundle} onChange={onModelChange} onNotice={onNotice}/>}
      {tab === "tools" && <>
        <div className="lab-label"><span className="local-dot"/>{t("LOCAL SECURITY LAB", "LOKALES SECURITY-LAB")}</div>
        <h2>{t("Small tools.", "Kleine Tools.")}<br/><span>{t("Sharp insights.", "Klare Einblicke.")}</span></h2>
        <div className="tool-picker">{(["url", "ioc", "json", "hash"] as Tool[]).map(item => { const Icon = icons[item]; return <button key={item} className={tool === item ? "active" : ""} onClick={() => changeTool(item)} disabled={running}><Icon size={16}/><span>{item === "url" ? "URL" : item === "ioc" ? t("Indicators", "Indikatoren") : item === "json" ? "JSON" : "SHA-256"}</span></button>; })}</div>
        <div className="tool-section-title"><ToolIcon size={17}/><h3>{names[tool]}</h3></div><p className="tool-description">{descriptions[tool]}</p>
        <div className="tool-input-label"><label htmlFor="studio-input">{t("INPUT", "EINGABE")}</label><button onClick={() => { setInput(samples[tool]); setResult(null); setError(""); }} disabled={running}>{t("Load example", "Beispiel laden")}<ArrowRight size={11}/></button></div>
        <textarea id="studio-input" value={input} onChange={event => { setInput(event.target.value); setResult(null); setError(""); }} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void run(); } }} placeholder={tool === "url" ? "https://example.org/…" : tool === "json" ? '{"event": "sign_in"}' : tool === "ioc" ? t("Paste a log excerpt…", "Log-Auszug einfügen…") : t("Enter text to fingerprint…", "Text für den Fingerabdruck eingeben…")} maxLength={tool === "url" ? 12000 : 100000} spellCheck={false} disabled={running}/>
        {tool === "hash" && <><button className="file-hash-button" onClick={() => fileInput.current?.click()} disabled={running}><Upload size={14}/>{t("Or select a file · up to 20 MB", "Oder Datei auswählen · bis 20 MB")}</button><input type="file" ref={fileInput} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(file); }}/></>}
        <button className="run-tool" onClick={() => void run()} disabled={running || (tool !== "hash" && !input.trim())}>{running ? <Loader2 size={15} className="spin"/> : <Play size={13} fill="currentColor"/>}{running ? t("Processing…", "Wird verarbeitet…") : t("Run locally", "Lokal ausführen")}<span>⌘↵</span></button>
        <div className="lab-privacy"><ShieldCheck size={11}/>{t("Runs in your browser. No network requests.", "Läuft im Browser. Keine Netzwerkanfragen.")}</div>
        {error && <div className="tool-error" role="alert">{errors[error] || errors.unknown}</div>}
        {result && <section className="tool-result" aria-live="polite"><div className="tool-result-heading"><span><Check size={13}/>{t("RESULT", "ERGEBNIS")}</span><div><button onClick={() => void copy(reportText)} aria-label={t("Copy tool result", "Tool-Ergebnis kopieren")}>{copied ? <Check size={13}/> : <Copy size={13}/>}</button><button onClick={() => downloadText(reportText, `aelvor-${result.tool}.${result.output && result.tool !== "json" ? "txt" : "json"}`)} aria-label={t("Download tool result", "Tool-Ergebnis herunterladen")}><Download size={13}/></button></div></div>
          {result.url && <><div className="url-facts"><div><span>{t("DESTINATION HOST", "ZIELHOST")}</span><strong>{result.url.host}</strong></div><div className="url-facts-pair"><div><span>{t("PROTOCOL", "PROTOKOLL")}</span><strong>{result.url.protocol}</strong></div><div><span>PORT</span><strong>{result.url.port}</strong></div><div><span>{t("PARAMETERS", "PARAMETER")}</span><strong>{result.url.parameterCount}</strong></div></div></div><div className="url-signals-title">{result.url.signals.length} {t("details to review", "Details zur Prüfung")}</div>{result.url.signals.map(signal => <div className="url-signal" key={signal}><span/><div><strong>{signals[signal][0]}</strong><p>{signals[signal][1]}</p></div></div>)}<div className="result-note">{t("Structural inspection only. This does not establish whether a destination is safe or malicious; no site was visited.", "Nur strukturelle Prüfung. Sie stellt nicht fest, ob ein Ziel sicher oder schädlich ist; keine Seite wurde aufgerufen.")}</div></>}
          {result.indicators && <><div className="ioc-summary">{Object.values(result.indicators).reduce((sum, values) => sum + values.length, 0)}<span>{t("unique candidates found", "eindeutige Kandidaten gefunden")}</span></div>{(Object.entries(result.indicators) as [keyof Indicators, string[]][]).map(([key, values]) => <div className="ioc-group" key={key}><h4>{key === "ipv4" ? "IPv4" : key === "urls" ? "URLs" : key === "emails" ? "Email" : "SHA-256"}<span>{values.length}</span></h4>{values.map(value => <code key={value}>{value}</code>)}</div>)}<div className="result-note">{t("Pattern matches are candidates, not proof of compromise. Each category is limited to 200 unique matches.", "Musterübereinstimmungen sind Kandidaten, kein Beweis für einen Angriff. Pro Kategorie höchstens 200 eindeutige Treffer.")}</div></>}
          {result.output && <>{result.filename && <div className="hashed-filename"><FileText size={13}/>{result.filename}</div>}<pre className={result.tool === "hash" ? "hash-output" : "json-output"}>{result.output}</pre>{result.tool === "hash" && <div className="result-note">{t("A hash supports integrity comparison. It is not a malware verdict.", "Ein Hash dient dem Integritätsvergleich. Er ist kein Malware-Urteil.")}</div>}</>}
        </section>}
      </>}
      {tab === "artifacts" && (artifact ? <div className="artifact-detail"><button className="artifact-back" onClick={() => onSelect(null)}><ChevronLeft size={13}/>{t("All artifacts", "Alle Artefakte")}</button><div className="artifact-detail-title"><span className="artifact-file-icon">{artifact.kind === "code" ? <FileCode2 size={23}/> : <FileText size={23}/>}</span><div><h3>{artifact.filename}</h3><span>{artifact.language}{artifact.demo ? ` · ${t("Prepared demo", "Vorbereitete Demo")}` : ""}</span></div></div><div className="artifact-title">{artifact.title}</div>{!previewable(artifact.language) && <div className="artifact-actions"><button onClick={() => void copy(artifact.content)}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? t("Copied", "Kopiert") : t("Copy", "Kopieren")}</button><button onClick={() => downloadText(artifact.content, artifact.filename)}><Download size={13}/>{t("Download", "Herunterladen")}</button></div>}{artifact.kind === "code" && previewable(artifact.language) ? <ArtifactWorkbench artifact={artifact} artifacts={artifacts} locale={locale} active={active && tab === "artifacts"} intent={artifactIntent} requestId={artifactRequest} onNotice={onNotice}/> : artifact.kind === "code" ? <div className="artifact-source"><div><span>{artifact.language}</span><span>{artifact.content.split("\n").length} {t("lines", "Zeilen")}</span></div><pre>{artifact.content.split("\n").map((line, index) => <div key={index}><span>{index + 1}</span><code>{line || " "}</code></div>)}</pre></div> : <Markdown text={artifact.content} locale={locale} onNotice={onNotice}/>}</div> : <><div className="lab-label"><FileCode2 size={12}/>{t("YOUR DELIVERABLES", "DEINE ERGEBNISSE")}</div><h2>{t("From ideas", "Von Ideen")}<br/><span>{t("to artifacts.", "zu Artefakten.")}</span></h2><p className="tool-description">{t("Code and documents from this conversation, ready to inspect and download.", "Code und Dokumente aus diesem Gespräch, bereit zum Prüfen und Herunterladen.")}</p><div className="artifact-list">{artifacts.length ? artifacts.map(item => <button key={item.id} onClick={() => onSelect(item.id)}><span className={`artifact-list-icon ${item.kind}`}>{item.kind === "code" ? <FileCode2 size={19}/> : <FileText size={19}/>}</span><span><strong>{item.filename}</strong><small>{item.title}</small></span><ChevronRight size={14}/></button>) : <div className="studio-empty"><FileCode2 size={30}/><strong>{t("Your next creation lives here.", "Dein nächstes Werk findet hier Platz.")}</strong><p>{t("Try a code playbook. Its output will appear here automatically.", "Probiere ein Code-Playbook aus. Das Ergebnis erscheint hier automatisch.")}</p></div>}</div></>)}
      {tab === "activity" && <><div className="lab-label"><Activity size={12}/>{t("THIS SESSION", "DIESE SITZUNG")}</div><h2>{t("Every action.", "Jede Aktion.")}<br/><span>{t("A clear trail.", "Klar dokumentiert.")}</span></h2><p className="tool-description">{t("Your last 12 local tool runs in this tab. Results stay in this session.", "Deine letzten 12 lokalen Tool-Ausführungen in diesem Tab. Ergebnisse bleiben in dieser Sitzung.")}</p>{runs.length ? <div className="run-history">{runs.map(item => <button key={item.id} disabled={running} onClick={() => { if (runningRef.current) return; setTool(item.tool); setInput(""); setResult(item.result || null); setError(item.error || ""); onTabChange("tools"); }}><span className={item.success ? "run-success" : "run-failure"}>{item.success ? <Check size={13}/> : <X size={13}/>}</span><span><strong>{names[item.tool]}</strong><small>{item.success ? t("Completed locally", "Lokal abgeschlossen") : t("Could not complete", "Nicht abgeschlossen")}</small></span><time>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(item.time)}</time></button>)}</div> : <div className="studio-empty"><Activity size={28}/><strong>{t("Ready when you are.", "Bereit, wenn du es bist.")}</strong><p>{t("Run a tool to start an activity trail.", "Starte ein Tool, um den Verlauf zu beginnen.")}</p></div>}</>}
    </div>
    <div className="studio-footer"><span className="local-dot"/>{t("Local tools · No AI connection required", "Lokale Tools · Keine AI-Verbindung nötig")}</div>
  </aside>;
}
