"use client";
// Copyright © 2026 Alen Pepa

import { Check, Copy, Download, FolderCode, PanelRightOpen, Play } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { attributeCode } from "../lib/copyright";
import { COPYRIGHT_NOTICE } from "../lib/brand";
import type { Locale } from "../lib/templates";
import { codeExtension, codeLanguage } from "../lib/local-tools";
import { previewable } from "../lib/artifact-project";
import { codeFences } from "../lib/code-fences";

export function downloadText(text: string, name: string, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), name);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function CodeBlock({ language, code, locale, onNotice, onOpen, complete, pending }: { language: string; code: string; locale: Locale; onNotice: (message: string) => void; onOpen?: (language: string, code: string, intent?: "code" | "preview" | "project") => void; complete: boolean; pending?: boolean }) {
  const [copied, setCopied] = useState(false);
  const attributed = attributeCode(code, language);
  const de = locale === "de";
  return <div className="code-block">
    <div className="code-header"><span><span className="code-dot" />{language || "text"}</span><div>
      {onOpen && <button title={de ? "Im Studio öffnen" : "Open in studio"} aria-label={de ? "Im Studio öffnen" : "Open in studio"} onClick={() => onOpen(language, attributed)}><PanelRightOpen size={13}/><span>Studio</span></button>}
      {onOpen && <button className="code-project-button" disabled={!complete || pending} title={de ? "Dateien als Code-Projekt organisieren" : "Organize files as a code project"} aria-label={de ? "Dateien als Code-Projekt organisieren" : "Organize files as a code project"} onClick={() => onOpen(language, attributed, "project")}><FolderCode size={13}/><span>{de ? "Projekt" : "Project"}</span></button>}
      {onOpen && previewable(language) && <button className="code-preview-button" disabled={!complete || pending} title={de ? "App-Vorschau öffnen" : "Open app preview"} aria-label={de ? "App-Vorschau öffnen" : "Open app preview"} onClick={() => onOpen(language, attributed, "preview")}><Play size={12}/><span>{de ? "Vorschau" : "Preview"}</span></button>}
      <button title={de ? "Code herunterladen" : "Download code"} aria-label={de ? "Code herunterladen" : "Download code"} onClick={() => downloadText(attributed, `aelvor-script.${codeExtension(language)}`)}><Download size={13}/></button>
      <button onClick={async () => { try { await navigator.clipboard.writeText(attributed); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { onNotice(de ? "Kopieren ist in diesem Browser nicht verfügbar." : "Clipboard access is unavailable in this browser."); } }}>{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? (de ? "Kopiert" : "Copied") : (de ? "Kopieren" : "Copy")}</button>
    </div></div>
    <div className="code-copyright">{COPYRIGHT_NOTICE}</div>
    <pre><code>{attributed}</code></pre>
  </div>;
}

export default function Markdown({ text, locale, onNotice, onOpen, pending }: { text: string; locale: Locale; onNotice: (message: string) => void; onOpen?: (language: string, code: string, intent?: "code" | "preview" | "project") => void; pending?: boolean }) {
  const parts: ({ type: "text"; text: string } | { type: "code"; text: string; info: string; closed: boolean })[] = [];
  let cursor = 0;
  for (const fence of codeFences(text)) { parts.push({ type: "text", text: text.slice(cursor, fence.start) }, { type: "code", text: fence.code, info: fence.info, closed: fence.closed }); cursor = fence.end; }
  parts.push({ type: "text", text: text.slice(cursor) });
  return <div className="markdown">{parts.map((part, partIndex) => {
    if (part.type === "code") return <CodeBlock key={partIndex} language={codeLanguage(part.info)} code={part.text.replace(/\n$/, "")} locale={locale} onNotice={onNotice} onOpen={onOpen} complete={part.closed} pending={pending}/>;
    const lines = part.text.split("\n");
    const nodes: ReactNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) { const Tag = heading[1].length <= 2 ? "h3" : "h4"; nodes.push(<Tag key={i}>{inline(heading[2])}</Tag>); continue; }
      if (/^\s*([-*]|\d+\.)\s/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items: ReactNode[] = [];
        const start = i;
        while (i < lines.length && (ordered ? /^\s*\d+\.\s/.test(lines[i]) : /^\s*[-*]\s/.test(lines[i]))) {
          items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>); i++;
        }
        i--;
        nodes.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>); continue;
      }
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const cells = (row: string) => row.replace(/^\s*\||\|\s*$/g, "").split("|").map(cell => cell.trim());
        const header = cells(line); const rows: string[][] = []; const start = i; i += 2;
        while (i < lines.length && lines[i].includes("|")) { rows.push(cells(lines[i])); i++; }
        i--;
        nodes.push(<div className="table-wrap" key={start}><table><thead><tr>{header.map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
      }
      nodes.push(<p key={i}>{inline(line.replace(/^>\s?/, ""))}</p>);
    }
    return <Fragment key={partIndex}>{nodes}</Fragment>;
  })}</div>;
}
