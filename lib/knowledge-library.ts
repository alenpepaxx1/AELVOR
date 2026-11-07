// Copyright © 2026 Alen Pepa
import { COPYRIGHT_NOTICE } from "./brand.ts";

export const knowledgeStorageKey = "aelvor-knowledge-v1";
export const knowledgeLimits = { documents: 24, documentCharacters: 40_000, totalCharacters: 320_000, fileBytes: 200_000, backupBytes: 2_000_000 } as const;
export const knowledgeFileAccept = ".txt,.md,.csv,.tsv,.json,.log";
export type KnowledgeDocument = { id: string; title: string; content: string; sourceUrl: string; sourceDate: string; updatedAt: number; enabled: boolean; retrievedAt?: number };
export type KnowledgeExcerpt = { reference: string; documentId: string; title: string; text: string; startLine: number; endLine: number; sourceUrl: string; sourceDate: string; updatedAt: number; retrievedAt?: number };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const title = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
function sourceDate(value: unknown): value is string {
  return value === "" || typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validKnowledgeUrl(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > 500 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}

export function validateKnowledgeDocuments(value: unknown): KnowledgeDocument[] {
  if (!Array.isArray(value) || value.length > knowledgeLimits.documents) throw Error("knowledge_limit");
  const ids = new Set<string>(); let total = 0;
  return value.map(item => {
    if (!record(item) || !identifier(item.id) || ids.has(item.id) || !title(item.title) || typeof item.content !== "string" || !item.content.trim() || item.content.includes("\u0000") || item.content.length > knowledgeLimits.documentCharacters
      || !validKnowledgeUrl(item.sourceUrl) || !sourceDate(item.sourceDate) || (!timestamp(item.updatedAt) || item.retrievedAt !== undefined && !timestamp(item.retrievedAt)) || typeof item.enabled !== "boolean") throw Error("knowledge_invalid");
    ids.add(item.id); total += item.content.length;
    if (total > knowledgeLimits.totalCharacters) throw Error("knowledge_limit");
    return { id: item.id, title: item.title, content: item.content, sourceUrl: item.sourceUrl, sourceDate: item.sourceDate, updatedAt: item.updatedAt, enabled: item.enabled, ...(item.retrievedAt !== undefined ? { retrievedAt: item.retrievedAt as number } : {}) };
  });
}

export function createKnowledgeDocument(input: { title: string; content: string; sourceUrl?: string; sourceDate?: string; retrievedAt?: number }, id: string, now = Date.now()): KnowledgeDocument {
  return validateKnowledgeDocuments([{ id, title: input.title.trim(), content: input.content, sourceUrl: input.sourceUrl?.trim() || "", sourceDate: input.sourceDate || "", updatedAt: now, enabled: true, ...(input.retrievedAt !== undefined ? { retrievedAt: input.retrievedAt } : {}) }])[0];
}
export function createKnowledgeBackup(documents: KnowledgeDocument[], now = new Date()) {
  return { format: "aelvor-knowledge", version: 1, copyright: COPYRIGHT_NOTICE, exportedAt: now.toISOString(), documents: validateKnowledgeDocuments(documents) };
}
export function parseKnowledgeBackup(text: string): KnowledgeDocument[] {
  if (new TextEncoder().encode(text).byteLength > knowledgeLimits.backupBytes) throw Error("knowledge_limit");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error("knowledge_invalid"); }
  if (!record(value) || value.format !== "aelvor-knowledge" || value.version !== 1) throw Error("knowledge_invalid");
  return validateKnowledgeDocuments(value.documents);
}
export function readKnowledgeLibrary(storage?: Pick<Storage, "getItem">): { documents: KnowledgeDocument[]; persisted: boolean; error?: string } {
  try {
    const text = (storage ?? globalThis.localStorage).getItem(knowledgeStorageKey);
    return { documents: text === null ? [] : parseKnowledgeBackup(text), persisted: true };
  } catch (error) { return { documents: [], persisted: false, error: error instanceof Error ? error.message : "knowledge_storage" }; }
}
export function writeKnowledgeLibrary(documents: KnowledgeDocument[], storage?: Pick<Storage, "setItem">): boolean {
  try { const text = JSON.stringify(createKnowledgeBackup(documents)); if (new TextEncoder().encode(text).byteLength > knowledgeLimits.backupBytes) return false; (storage ?? globalThis.localStorage).setItem(knowledgeStorageKey, text); return true; } catch { return false; }
}

export function mergeKnowledgeDocuments(existing: KnowledgeDocument[], incoming: KnowledgeDocument[], makeId: () => string) {
  const documents = validateKnowledgeDocuments(existing), additions = validateKnowledgeDocuments(incoming), ids = new Set(documents.map(item => item.id));
  const fingerprint = (item: KnowledgeDocument) => JSON.stringify([item.title, item.content, item.sourceUrl, item.sourceDate]);
  const known = new Set(documents.map(fingerprint)); let skipped = 0;
  for (const item of additions) {
    const key = fingerprint(item);
    if (known.has(key)) { skipped++; continue; }
    let id = item.id;
    if (ids.has(id)) {
      let found = false;
      for (let attempt = 0; attempt < 100; attempt++) { id = makeId(); if (identifier(id) && !ids.has(id)) { found = true; break; } }
      if (!found) throw Error("knowledge_id_collision");
    }
    ids.add(id); known.add(key); documents.push({ ...item, id });
  }
  return { documents: validateKnowledgeDocuments(documents), added: documents.length - existing.length, skipped };
}

export async function readKnowledgeFiles(files: { name: string; size: number; text: () => Promise<string> }[], makeId: () => string, options: { signal: AbortSignal; onReject: (code: string, name: string) => void }) {
  const result: KnowledgeDocument[] = [];
  const check = () => { if (options.signal.aborted) throw new DOMException("Aborted", "AbortError"); };
  check();
  for (const file of files.slice(5)) options.onReject("knowledge_file_count", file.name);
  for (const file of files.slice(0, 5)) {
    check();
    if (!/\.(txt|md|csv|tsv|json|log)$/i.test(file.name)) { options.onReject("knowledge_format", file.name); continue; }
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > knowledgeLimits.fileBytes) { options.onReject("knowledge_file_size", file.name); continue; }
    let content: string;
    try { content = await file.text(); } catch { check(); options.onReject("knowledge_read", file.name); continue; }
    check();
    if (typeof content !== "string" || content.length > knowledgeLimits.documentCharacters) { options.onReject("knowledge_file_size", file.name); continue; }
    try { result.push(createKnowledgeDocument({ title: file.name, content }, makeId())); }
    catch { options.onReject("knowledge_invalid", file.name); }
  }
  check(); return result;
}

// Restore source snapshots independently of the current library. Removing or
// editing a document must not rewrite evidence already kept with an answer.
export function restoreKnowledgeExcerpts(value: unknown): KnowledgeExcerpt[] {
  if (!Array.isArray(value) || value.length > 3) return [];
  const references = new Set<string>(), result: KnowledgeExcerpt[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.reference !== "string" || !/^K[1-3]$/.test(item.reference) || references.has(item.reference) || !identifier(item.documentId) || !title(item.title) || typeof item.text !== "string" || !item.text || item.text.length > 1200 || item.text.includes("\u0000")
      || typeof item.startLine !== "number" || !Number.isSafeInteger(item.startLine) || item.startLine < 1 || item.startLine > 40_001 || item.endLine !== item.startLine + (item.text.match(/\n/g)?.length || 0) || !validKnowledgeUrl(item.sourceUrl) || !sourceDate(item.sourceDate) || (!timestamp(item.updatedAt) || item.retrievedAt !== undefined && !timestamp(item.retrievedAt))) continue;
    references.add(item.reference);
    result.push({ reference: item.reference, documentId: item.documentId, title: item.title, text: item.text, startLine: item.startLine, endLine: item.endLine as number, sourceUrl: item.sourceUrl, sourceDate: item.sourceDate, updatedAt: item.updatedAt, ...(item.retrievedAt !== undefined ? { retrievedAt: item.retrievedAt as number } : {}) });
  }
  return result;
}
