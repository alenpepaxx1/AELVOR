// Copyright © 2026 Alen Pepa
import { restoreWorkspace, type Chat, type Message } from "./workspace-state.ts";
import { COPYRIGHT_NOTICE } from "./brand.ts";
import { projectLimit, restoreProjects, type Project } from "./projects.ts";

export const backupLimits = { bytes: 10 * 1024 * 1024, chats: 2000, messages: 50_000 } as const;
export type ConversationBackup = { format: "aelvor-conversations"; version: 1; copyright: string; exportedAt: string; chats: Chat[]; projects?: Project[] };
export type SearchFilter = "all" | "pinned" | "saved";
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;

export function sortedConversations(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

export function createConversationBackup(chats: Chat[], now = new Date(), projects: Project[] = []): ConversationBackup {
  // Snapshot pending replies as stopped without mutating the live conversation.
  const restored = restoreWorkspace({ chats, projects });
  return { format: "aelvor-conversations", version: 1, copyright: COPYRIGHT_NOTICE, exportedAt: now.toISOString(), chats: restored.chats, ...(restored.projects.length ? { projects: restored.projects } : {}) };
}

export function parseConversationBackup(text: string): { backup: ConversationBackup; messages: number; recovered: number } {
  if (new TextEncoder().encode(text).byteLength > backupLimits.bytes) throw new Error("backup_too_large");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("backup_invalid_json"); }
  if (!record(data) || data.format !== "aelvor-conversations" || data.version !== 1 || !Array.isArray(data.chats) || data.chats.length > backupLimits.chats) throw new Error("backup_invalid_format");
  const projects = restoreProjects(data.projects);
  if (data.projects !== undefined && (!Array.isArray(data.projects) || data.projects.length > projectLimit || projects.length !== data.projects.length)) throw new Error("backup_invalid_format");
  const chatIds = new Set<string>(); let messages = 0;
  for (const chat of data.chats) {
    if (!record(chat) || !identifier(chat.id) || chatIds.has(chat.id) || typeof chat.title !== "string" || chat.title.length > 1000 || !Array.isArray(chat.messages) || typeof chat.updatedAt !== "number" || !Number.isFinite(chat.updatedAt)) throw new Error("backup_invalid_format");
    chatIds.add(chat.id); const messageIds = new Set<string>();
    messages += chat.messages.length; if (messages > backupLimits.messages) throw new Error("backup_too_large");
    for (const message of chat.messages) {
      if (!record(message) || !identifier(message.id) || messageIds.has(message.id) || !["user", "assistant"].includes(message.role as string) || typeof message.content !== "string" || message.content.length > 1_000_000) throw new Error("backup_invalid_format");
      messageIds.add(message.id);
      if (message.attachments !== undefined) {
        if (!Array.isArray(message.attachments) || message.attachments.length > 3) throw new Error("backup_invalid_format");
        for (const file of message.attachments) if (!record(file) || typeof file.name !== "string" || file.name.length > 1000 || typeof file.content !== "string" || file.content.length > 100_000) throw new Error("backup_invalid_format");
      }
    }
  }
  const restored = restoreWorkspace({ chats: data.chats, projects });
  return { backup: createConversationBackup(restored.chats, new Date(), projects), messages, recovered: restored.repaired };
}

function fingerprint(chat: Chat, projects: Project[] = []): string {
  const normalized = restoreWorkspace({ chats: [chat], projects }).chats[0];
  return JSON.stringify({ title: normalized.title, updatedAt: normalized.updatedAt, pinned: normalized.pinned === true, projectId: normalized.projectId || null, messages: normalized.messages.map(message => {
    const { id: _id, attachments, ...body } = message;
    return { ...body, ...(attachments?.length ? { attachments: attachments.map(({ id: _fileId, ...file }) => file) } : {}) };
  }) });
}

function idFactory(existing: Chat[], makeId: () => string, projectIds: string[] = []) {
  const used = new Set([...projectIds, ...existing.flatMap(chat => [chat.id, ...chat.messages.flatMap(message => [message.id, ...(message.attachments || []).map(file => file.id)])])]);
  return () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = makeId(); if (identifier(id) && !used.has(id)) { used.add(id); return id; }
    }
    throw new Error("conversation_id_collision");
  };
}

export function mergeConversationBackup(existing: Chat[], backup: ConversationBackup, makeId: () => string, existingProjects: Project[] = []) {
  const freshId = idFactory(existing, makeId, existingProjects.map(project => project.id));
  const projects = [...existingProjects], projectRemap = new Map<string, string>();
  for (const incoming of backup.projects || []) {
    const duplicate = projects.find(project => project.name.toLowerCase() === incoming.name.toLowerCase());
    const project = duplicate || { ...incoming, id: freshId() };
    projectRemap.set(incoming.id, project.id); if (!duplicate) projects.push(project);
  }
  if (projects.length > projectLimit) throw new Error("backup_too_large");
  const known = new Map(existing.map(chat => [fingerprint(chat, projects), chat.id]));
  const remap = new Map<string, string>(), additions: Chat[] = []; let skipped = 0;
  for (const original of backup.chats) {
    const incoming = { ...original, projectId: original.projectId ? projectRemap.get(original.projectId) : undefined };
    const key = fingerprint(incoming, projects), duplicate = known.get(key);
    if (duplicate) { remap.set(incoming.id, duplicate); skipped++; continue; }
    const id = freshId(); remap.set(incoming.id, id); known.set(key, id);
    additions.push({ ...incoming, id, messages: incoming.messages.map(message => ({ ...message, id: freshId(), ...(message.attachments ? { attachments: message.attachments.map(file => ({ ...file, id: freshId() })) } : {}) })) });
  }
  if (existing.length + additions.length > backupLimits.chats || [...existing, ...additions].reduce((count, chat) => count + chat.messages.length, 0) > backupLimits.messages) throw new Error("backup_too_large");
  for (const chat of additions) {
    if (chat.sourceChatId) chat.sourceChatId = remap.get(chat.sourceChatId) || existing.find(item => item.id === chat.sourceChatId)?.id;
  }
  return { chats: [...existing, ...additions], projects, projectsAdded: projects.length - existingProjects.length, added: additions.length, skipped, firstId: additions[0]?.id };
}

export function questionForResponse(chat: Chat, messageId: string): Message | undefined {
  const index = chat.messages.findIndex(message => message.id === messageId);
  if (index < 0) return undefined;
  for (let cursor = index; cursor >= 0; cursor--) if (chat.messages[cursor].role === "user") return chat.messages[cursor];
}

function branchCloner(chat: Chat, makeId: () => string) {
  const freshId = idFactory([chat], makeId);
  const clone = (message: Message): Message => {
    const { saved: _saved, ...copy } = message;
    return { ...copy, id: freshId(), ...(message.attachments ? { attachments: message.attachments.map(file => ({ ...file, id: freshId() })) } : {}), ...(message.knowledge ? { knowledge: message.knowledge.map(source => ({ ...source })) } : {}), ...(message.quality ? { quality: { ...message.quality, unknownCitations: [...message.quality.unknownCitations] } } : {}) };
  };
  return { freshId, clone };
}

export function branchQuestion(chat: Chat, questionId: string, text: string, makeId: () => string, now = Date.now()): { chat: Chat; question: Message; history: Message[] } {
  const index = chat.messages.findIndex(message => message.id === questionId && message.role === "user");
  if (index < 0 || !text.trim()) throw new Error("conversation_question_missing");
  const { freshId, clone } = branchCloner(chat, makeId);
  const history = chat.messages.slice(0, index).map(clone);
  const source = clone(chat.messages[index]);
  const question: Message = { id: source.id, role: "user", content: text.trim(), ...(source.attachments ? { attachments: source.attachments } : {}), ...(source.language ? { language: source.language } : {}) };
  return { chat: { id: freshId(), title: chat.title, updatedAt: now, messages: [...history, question], sourceChatId: chat.id, projectId: chat.projectId }, question, history };
}

function branchResponse(chat: Chat, responseId: string, text: string, makeId: () => string, now: number, intent: "continue" | "refine"): { chat: Chat; question: Message; history: Message[] } {
  const index = chat.messages.findIndex(message => message.id === responseId);
  const response = chat.messages[index];
  if (!response || response.role !== "assistant" || response.pending || response.error || response.stopped || response.demo || (intent === "continue" ? response.finishReason !== "length" : response.kind !== "conversation") || !response.content.trim() || !text.trim() || chat.messages[index - 1]?.role !== "user") throw new Error(intent === "continue" ? "conversation_continuation_missing" : "conversation_refinement_missing");
  const { freshId, clone } = branchCloner(chat, makeId);
  // Keep the selected answer in context; later turns and unsent draft
  // attachments must never become part of this continuation request.
  const history = chat.messages.slice(0, index + 1).map(clone);
  const question: Message = { id: freshId(), role: "user", content: text.trim() };
  return { chat: { id: freshId(), title: chat.title, updatedAt: now, messages: [...history, question], sourceChatId: chat.id, projectId: chat.projectId }, question, history };
}

export function branchContinuation(chat: Chat, responseId: string, text: string, makeId: () => string, now = Date.now()) { return branchResponse(chat, responseId, text, makeId, now, "continue"); }
export function branchRefinement(chat: Chat, responseId: string, text: string, makeId: () => string, now = Date.now()) { return branchResponse(chat, responseId, text, makeId, now, "refine"); }

function queryTerms(query: string): string[] { return [...new Set(query.trim().toLowerCase().slice(0, 240).split(/\s+/).filter(Boolean))].slice(0, 12); }
function messageText(message: Message): string { return [message.content, ...(message.attachments || []).flatMap(file => [file.name, file.content])].join(" "); }
export function searchConversations(chats: Chat[], query: string, filter: SearchFilter = "all", limit = 50, projects: Project[] = []) {
  const terms = queryTerms(query), hits: { chat: Chat; messageId?: string; snippet: string; score: number }[] = [];
  for (const chat of sortedConversations(chats)) {
    if (filter === "pinned" && !chat.pinned) continue;
    const messages = filter === "saved" ? chat.messages.filter(message => message.saved) : chat.messages;
    if (filter === "saved" && !messages.length) continue;
    const title = chat.title.toLowerCase(), project = projects.find(project => project.id === chat.projectId)?.name || "", body = messages.map(messageText), combined = `${title} ${project} ${body.join(" ")}`.toLowerCase();
    if (!terms.every(term => combined.includes(term))) continue;
    const scored = messages.map((message, index) => ({ message, text: body[index], score: terms.filter(term => body[index].toLowerCase().includes(term)).length }));
    scored.sort((a, b) => b.score - a.score);
    const best = terms.length && scored[0]?.score ? scored[0] : undefined;
    const text = (best?.text || messages.at(-1)?.content || "").replace(/\s+/g, " ").trim();
    const match = terms.map(term => text.toLowerCase().indexOf(term)).filter(index => index >= 0);
    const start = Math.max(0, (match.length ? Math.min(...match) : 0) - 50);
    hits.push({ chat, messageId: best?.message.id, snippet: `${start ? "…" : ""}${text.slice(start, start + 190)}${text.length > start + 190 ? "…" : ""}`, score: terms.filter(term => title.includes(term)).length * 5 + (best?.score || 0) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit));
}

export function highlightedText(text: string, query: string): { text: string; match: boolean }[] {
  const terms = queryTerms(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return text.split(pattern).filter(Boolean).map(part => ({ text: part, match: terms.includes(part.toLowerCase()) }));
}
