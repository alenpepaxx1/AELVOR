// Copyright © 2026 Alen Pepa
import type { Attachment } from "./workspace-state.ts";
import type { AgentMode } from "./templates.ts";
export type Draft = { chatId: string | null; text: string; attachments: Attachment[]; mode: AgentMode; engine: "chat" | "tools"; updatedAt: number };
export const draftsStorageKey = "aelvor-drafts-v1";
export const draftLimit = 50;
const storageCharacterLimit = 3_000_000;
export type DraftStorageIssue = { kind: "invalid" | "unavailable"; raw: string | null };
type DraftRead = { drafts: Draft[]; issue: DraftStorageIssue | null };
type DraftStorageHost = Pick<Storage, "getItem" | "setItem">;

// Timer and page lifecycle callbacks can outlive a composer action until React
// cleans up its effects. Invalidate them before sending, discarding or switching.
export class DraftAutosave {
  private revision = 0;
  invalidate(): void { this.revision++; }
  createSave(save: () => void): () => void {
    const revision = this.revision;
    return () => { if (revision === this.revision) save(); };
  }
}

function normalizeDraft(value: unknown): Draft | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!(item.chatId === null || typeof item.chatId === "string" && item.chatId.length > 0 && item.chatId.length <= 200) || typeof item.text !== "string" || item.text.length > 20_000 || !Array.isArray(item.attachments) || item.attachments.length > 3) return null;
  const attachments: Attachment[] = [];
  for (const file of item.attachments) {
    if (!file || typeof file.id !== "string" || !file.id || file.id.length > 200 || typeof file.name !== "string" || file.name.length > 1000 || typeof file.content !== "string" || file.content.length > 12000) return null;
    attachments.push({ id: file.id, name: file.name, content: file.content, truncated: file.truncated === true });
  }
  if (!item.text.length && !attachments.length) return null;
  return { chatId: item.chatId, text: item.text, attachments, mode: ["investigate", "build", "learn"].includes(item.mode as string) ? item.mode as AgentMode : "auto", engine: item.engine === "tools" ? "tools" : "chat", updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : 0 };
}
export function readDraftState(chatIds: Set<string>, storage?: Pick<Storage, "getItem">): DraftRead {
  let raw: string | null;
  try { raw = (storage ?? globalThis.localStorage).getItem(draftsStorageKey); }
  catch { return { drafts: [], issue: { kind: "unavailable", raw: null } }; }
  if (raw === null) return { drafts: [], issue: null };
  try {
    if (!raw || raw.length > storageCharacterLimit) throw Error("drafts_shape");
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || data.version !== 1 || !Array.isArray(data.drafts)) throw Error("drafts_shape");
    const result: Draft[] = [], seen = new Set<string | null>();
    for (const item of data.drafts.slice(0, draftLimit)) {
      const draft = normalizeDraft(item);
      if (!draft || seen.has(draft.chatId) || draft.chatId !== null && !chatIds.has(draft.chatId)) continue;
      result.push(draft); seen.add(draft.chatId);
    }
    return { drafts: result, issue: null };
  } catch { return { drafts: [], issue: { kind: "invalid", raw } }; }
}
export function readDrafts(chatIds: Set<string>, storage?: Pick<Storage, "getItem">): Draft[] { return readDraftState(chatIds, storage).drafts; }
export function updateDraft(drafts: Draft[], chatId: string | null, value: Omit<Draft, "chatId" | "updatedAt">, now = Date.now()): Draft[] {
  const next = normalizeDraft({ ...value, chatId, updatedAt: now });
  if (!next && (value.text.length || value.attachments.length)) return drafts;
  const rest = drafts.filter(draft => draft.chatId !== chatId);
  return next ? [next, ...rest].slice(0, draftLimit) : rest;
}
export function removeDraft(drafts: Draft[], chatId: string | null): Draft[] { return drafts.filter(draft => draft.chatId !== chatId); }
export function writeDrafts(drafts: Draft[], storage?: Pick<Storage, "setItem">): boolean {
  try { const text = JSON.stringify({ version: 1, drafts }); if (text.length > storageCharacterLimit) return false; (storage ?? globalThis.localStorage).setItem(draftsStorageKey, text); return true; } catch { return false; }
}

/** Keep unreadable saved drafts untouched until the user chooses replacement. */
export class DraftStorage {
  private allowed = false;
  private readonly host: () => DraftStorageHost;
  constructor(host: () => DraftStorageHost = () => globalThis.localStorage) { this.host = host; }
  get writable() { return this.allowed; }
  read(chatIds: Set<string>): DraftRead {
    this.allowed = false;
    let result: DraftRead;
    try { result = readDraftState(chatIds, this.host()); }
    catch { result = { drafts: [], issue: { kind: "unavailable", raw: null } }; }
    this.allowed = result.issue === null;
    return result;
  }
  save(drafts: Draft[]): boolean { return this.allowed && this.persist(drafts); }
  replace(drafts: Draft[]): boolean {
    this.allowed = false;
    if (!this.persist(drafts)) return false;
    this.allowed = true;
    return true;
  }
  private persist(drafts: Draft[]): boolean {
    try { return writeDrafts(drafts, this.host()); } catch { return false; }
  }
}
