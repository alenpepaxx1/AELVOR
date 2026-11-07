// Copyright © 2026 Alen Pepa
import { normalizeAssistantPreferences, type AssistantPreferences } from "./assistant-preferences.ts";
import { contextualQuestion } from "./generation-policy.ts";
import { fileExcerptSelector, retrievalTerms } from "./local-retrieval.ts";
import { searchKnowledge } from "./knowledge-retrieval.ts";
import type { KnowledgeDocument, KnowledgeExcerpt } from "./knowledge-library.ts";
import type { ChatTurn } from "./conversation.ts";
import type { Locale } from "./templates.ts";
type File = { name: string; content: string; truncated?: boolean };
type Request = { text: string; locale: Locale; files?: File[]; history?: ChatTurn[]; knowledge?: KnowledgeDocument[]; preferences?: AssistantPreferences };
export const isDocumentFile = (name: string) => /\.(?:txt|md|csv|tsv|json)$/i.test(name);
export const isDocumentSummary = (text: string) => /^(?:(?:please|bitte)\s+)?(?:summari[sz]e\b|zusammenfass\w*|fass(?:e)?\b[^\n]{0,100}\bzusammen\b)/i.test(text.trim());
const safeTitle = (text: string) => text.replace(/[\\`*_[\]<>|]/g, "\\$&").replace(/[\r\n]/g, " ");
function excerptBlock(text: string) { const runs = [...text.matchAll(/`+/g)].map(match => match[0].length), fence = "`".repeat(Math.max(3, ...runs.map(length => length + 1))); return `${fence}text\n${text}\n${fence}`; }
function clipped(text: string, maximum: number) { let end = Math.min(text.length, maximum); if (/[\uD800-\uDBFF]/.test(text[end - 1] || "") && /[\uDC00-\uDFFF]/.test(text[end] || "")) end--; return text.slice(0, end); }

// Extractive summaries choose real paragraphs, never synthetic claims. Rank by
// distinct topic coverage, then retain source order and exact original offsets.
export function summarizeDocument(document: KnowledgeDocument, count = 3): KnowledgeExcerpt[] {
  const blocks = [...document.content.matchAll(/\S[\s\S]*?(?=\n[\t ]*\n|$)/g)].filter(match => match[0].trim());
  const frequency = new Map<string, number>();
  const candidates = blocks.map(match => { const keys = new Set(retrievalTerms(match[0])); for (const key of keys) frequency.set(key, (frequency.get(key) || 0) + 1); return { match, keys }; });
  const chosen = candidates.map(item => ({ ...item, score: [...item.keys].reduce((sum, key) => sum + 1 / (frequency.get(key) || 1), 0) / Math.sqrt(Math.max(20, item.match[0].length)) })).sort((a, b) => b.score - a.score || a.match.index - b.match.index).slice(0, Math.max(1, Math.min(3, count))).sort((a, b) => a.match.index - b.match.index);
  return chosen.map(({ match }, index) => {
    const text = clipped(match[0], 800), startLine = 1 + (document.content.slice(0, match.index).match(/\n/g)?.length || 0);
    return { reference: `K${index + 1}`, documentId: document.id, title: document.title, text, startLine, endLine: startLine + (text.match(/\n/g)?.length || 0), sourceUrl: document.sourceUrl, sourceDate: document.sourceDate, updatedAt: document.updatedAt, ...(document.retrievedAt !== undefined ? { retrievedAt: document.retrievedAt } : {}) };
  });
}

export function localDocumentReply(request: Request): { text: string; knowledge: KnowledgeExcerpt[]; steps: string[]; language: Locale; kind: "knowledge" } | null {
  const t = (en: string, de: string) => request.locale === "de" ? de : en, preferences = normalizeAssistantPreferences(request.preferences);
  const sourceFiles = (request.files || []).filter(file => isDocumentFile(file.name));
  const documents: KnowledgeDocument[] = sourceFiles.slice(0, 3).map((file, index) => ({ id: `attachment-${index + 1}`, title: file.name.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120) || "Document", content: clipped(file.content, 40_000), sourceUrl: "", sourceDate: "", updatedAt: 0, enabled: true }));
  const library = preferences.knowledge === "off" ? [] : (request.knowledge || []).filter(document => document.enabled);
  const question = contextualQuestion(request.text, request.history), summary = isDocumentSummary(request.text), maximum = preferences.style === "concise" ? 1 : 3;
  let selected: KnowledgeExcerpt[];
  if (summary) {
    const relevantIds = new Set(searchKnowledge(library, question, maximum).map(item => item.documentId));
    const relevant = documents.length ? documents : library.filter(document => relevantIds.has(document.id));
    selected = relevant.length === 1 ? summarizeDocument(relevant[0], maximum) : relevant.slice(0, maximum).flatMap(document => summarizeDocument(document, 1));
  } else selected = searchKnowledge([...documents, ...library], question, maximum);
  selected = selected.map((item, index) => ({ ...item, reference: `K${index + 1}` }));
  if (!selected.length) {
    if (!documents.length && preferences.knowledge !== "focused") return null;
    return { text: t("## No matching source excerpt\nI could not find a matching passage in the supplied text or enabled knowledge. Add the relevant source, name the topic more precisely, or use a loaded AI model for a broader explanation.", "## Kein passender Quellenauszug\nIch habe keine passende Stelle im übergebenen Text oder aktivierten Wissen gefunden. Ergänze die relevante Quelle, benenne das Thema genauer oder nutze ein geladenes AI-Modell für eine breitere Erklärung."), knowledge: [], steps: ["search-local-documents"], language: request.locale, kind: "knowledge" };
  }
  const partial = sourceFiles.some(file => file.truncated || file.content.length > 40_000);
  const title = summary ? t("Extractive document summary", "Extraktive Dokumentzusammenfassung") : t("Matching source passages", "Passende Quellenstellen");
  const output = selected.map(item => `### [${item.reference}] ${safeTitle(item.title)}\n${t("Lines", "Zeilen")} ${item.startLine}–${item.endLine}${item.sourceDate ? ` · ${item.sourceDate}` : ""}${item.retrievedAt !== undefined ? ` · ${t("Retrieved", "Abgerufen")} ${new Date(item.retrievedAt).toISOString()}` : ""}\n\n${excerptBlock(item.text)}`).join("\n\n");
  return { text: `## ${title}\n${t("Selected original passages, not a generated explanation. These excerpts can omit relevant context; source claims are not independently verified.", "Ausgewählte Originalstellen, keine generierte Erklärung. Diese Auszüge können relevanten Kontext auslassen; Quellenaussagen sind nicht unabhängig geprüft.")}\n\n${output}\n\n${partial ? t("The attachment was shortened; results cover only the supplied portion. ", "Der Anhang wurde gekürzt; die Ergebnisse beziehen sich nur auf den übergebenen Teil. ") : ""}${t("Local extraction only. No URL was fetched during this reply and source text was not executed.", "Nur lokale Extraktion. Während dieser Antwort wurde keine URL abgerufen und Quelltext wurde nicht ausgeführt.")}`, knowledge: selected, steps: ["search-local-documents", summary ? "extract-summary-passages" : "select-source-passages"], language: request.locale, kind: "knowledge" };
}
