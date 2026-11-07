// Copyright © 2026 Alen Pepa
import { attributeCode, attributeMarkdown } from "./copyright.ts";
import { codeLanguage, codeExtension, explicitCodeFilename } from "./code-files.ts";
import { codeFences } from "./code-fences.ts";
export type UrlSignal = "http" | "credentials" | "ip" | "idn" | "subdomains" | "redirect" | "secret";
export type UrlInspection = { host: string; protocol: string; port: string; path: string; parameterCount: number; signals: UrlSignal[] };

export function inspectUrl(input: string): UrlInspection {
  if (input.length > 12000) throw new Error("too_long");
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("invalid_url"); }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("invalid_url");
  const signals: UrlSignal[] = [];
  if (url.protocol === "http:") signals.push("http");
  if (url.username || url.password) signals.push("credentials");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.startsWith("[")) signals.push("ip");
  if (url.hostname.split(".").some(label => label.startsWith("xn--"))) signals.push("idn");
  if (url.hostname.split(".").length > 4) signals.push("subdomains");
  if (Array.from(url.searchParams.keys()).some(key => /^(password|token|api[-_]?key|secret|access_token|session)$/i.test(key))) signals.push("secret");
  for (const [key, value] of url.searchParams) {
    if (!/^(redirect|return|url|next|continue|target|destination)([-_]?(url|uri|to))?$/i.test(key)) continue;
    try { if (new URL(value).hostname !== url.hostname) { signals.push("redirect"); break; } } catch { /* Relative redirects do not expose a separate host here. */ }
  }
  return { host: url.hostname, protocol: url.protocol.replace(":", "").toUpperCase(), port: url.port || (url.protocol === "https:" ? "443" : "80"), path: url.pathname, parameterCount: Array.from(url.searchParams).length, signals };
}

export type Indicators = { ipv4: string[]; urls: string[]; emails: string[]; sha256: string[] };
const unique = (values: string[]) => [...new Set(values)].slice(0, 200);

export function extractIndicators(input: string): Indicators {
  if (input.length > 100000) throw new Error("too_long");
  const ipv4 = (input.match(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g) || []).filter(ip => ip.split(".").every(part => Number(part) <= 255 && (part === "0" || !part.startsWith("0"))));
  return {
    ipv4: unique(ipv4),
    urls: unique((input.match(/https?:\/\/[^\s<>"'`]+/gi) || []).map(value => value.replace(/[),.;\]}]+$/, ""))),
    emails: unique(input.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi) || []),
    sha256: unique((input.match(/\b[a-f0-9]{64}\b/gi) || []).map(value => value.toLowerCase())),
  };
}

export function formatJson(input: string): string {
  if (input.length > 100000) throw new Error("too_long");
  try { return JSON.stringify(JSON.parse(input), null, 2); } catch { throw new Error("invalid_json"); }
}

export async function hashSha256(input: string | ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("secure_context_required");
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export type Artifact = { id: string; title: string; filename: string; language: string; content: string; kind: "code" | "document"; demo?: boolean; messageId?: string; filenameExplicit?: boolean };
export { fileExtensions, codeLanguage, codeExtension } from "./code-files.ts";

export function extractArtifacts(messages: { id: string; role: string; content: string; demo?: boolean }[]): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const title = message.content.split("\n").find(line => /^#{1,4}\s/.test(line))?.replace(/^#+\s*/, "").slice(0, 90) || "AELVOR response";
    let index = 0;
    for (const fence of codeFences(message.content)) {
      if (!fence.closed) continue;
      const language = codeLanguage(fence.info);
      const requested = /\b(?:filename|file)=["']?([^\s"'`]+)/i.exec(fence.info)?.[1] || (/^[\w./-]+\.[\w]+(?:\s|$)/.test(fence.info.trim()) ? fence.info.trim().split(/\s/)[0] : "");
      const explicit = explicitCodeFilename(requested, language);
      const allowed = Boolean(explicit);
      artifacts.push({ id: `${message.id}:${index}`, messageId: message.id, title, filename: explicit || `aelvor-${index + 1}.${codeExtension(language)}`, filenameExplicit: allowed, language, content: attributeCode(fence.code.replace(/\n$/, ""), language), kind: "code", demo: message.demo }); index++;
    }
    if (message.content.length > 150) artifacts.push({ id: `${message.id}:document`, title, filename: "aelvor-response.md", language: "markdown", content: attributeMarkdown(message.content), kind: "document", demo: message.demo });
  }
  return artifacts;
}
