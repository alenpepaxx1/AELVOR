// Copyright © 2026 Alen Pepa
import type { GenerationMetrics } from "./conversation.ts";
import type { Locale } from "./templates.ts";
import { restoreProjects } from "./projects.ts";
import { restoreKnowledgeExcerpts, type KnowledgeExcerpt } from "./knowledge-library.ts";
import { restoreResponseQuality, type ResponseQuality } from "./response-quality.ts";

export type Attachment = { id: string; name: string; content: string; truncated: boolean };
export type Message = { id: string; role: "user" | "assistant"; content: string; attachments?: Attachment[]; knowledge?: KnowledgeExcerpt[]; quality?: ResponseQuality; demo?: boolean; saved?: boolean; stopped?: boolean; error?: boolean; pending?: boolean; language?: Locale; local?: boolean; steps?: string[]; kind?: string; model?: string; contextShortened?: boolean; finishReason?: string; metrics?: GenerationMetrics };
export type Chat = { id: string; title: string; updatedAt: number; messages: Message[]; pinned?: boolean; sourceChatId?: string; projectId?: string };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const shortString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

export function restoreWorkspace(input: unknown) {
  const data = record(input) ? input : {};
  const locale: Locale = data.locale === "de" ? "de" : "en";
  const projects = restoreProjects(data.projects), projectIds = new Set(projects.map(project => project.id));
  const chats: Chat[] = [], chatIds = new Set<string>();
  let repaired = 0;
  for (const value of Array.isArray(data.chats) ? data.chats : []) {
    if (!record(value) || typeof value.id !== "string" || !value.id || chatIds.has(value.id) || !Array.isArray(value.messages)) { repaired++; continue; }
    chatIds.add(value.id);
    const messages: Message[] = [], messageIds = new Set<string>();
    for (const candidate of value.messages) {
      if (!record(candidate) || typeof candidate.id !== "string" || !candidate.id || messageIds.has(candidate.id) || (candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") { repaired++; continue; }
      messageIds.add(candidate.id);
      const message: Message = { id: candidate.id, role: candidate.role as Message["role"], content: candidate.content };
      for (const flag of ["demo", "saved", "stopped", "error", "local", "contextShortened"] as const) if (candidate[flag] === true) message[flag] = true;
      if (candidate.language === "en" || candidate.language === "de") message.language = candidate.language;
      if (shortString(candidate.kind, 40)) message.kind = candidate.kind;
      if (shortString(candidate.model, 80)) message.model = candidate.model;
      if (shortString(candidate.finishReason, 40)) message.finishReason = candidate.finishReason;
      if (candidate.role === "assistant") { const quality = restoreResponseQuality(candidate.quality); if (quality) message.quality = quality; }
      if (candidate.role === "assistant" && candidate.knowledge !== undefined) { const excerpts = restoreKnowledgeExcerpts(candidate.knowledge); if (excerpts.length) message.knowledge = excerpts; if (!Array.isArray(candidate.knowledge) || excerpts.length !== candidate.knowledge.length) repaired++; }
      if (record(candidate.metrics)) {
        const value = candidate.metrics;
        const valid = (candidate: unknown, maximum: number): candidate is number => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 && candidate <= maximum;
        if (valid(value.elapsedMs, 86_400_000) && (value.firstTokenMs === null || valid(value.firstTokenMs, value.elapsedMs)) && Number.isInteger(value.contextRetries) && valid(value.contextRetries, 4)) {
          message.metrics = { elapsedMs: value.elapsedMs, firstTokenMs: value.firstTokenMs as number | null, contextRetries: value.contextRetries };
          if (Number.isSafeInteger(value.completionTokens) && valid(value.completionTokens, 10_000_000)) message.metrics.completionTokens = value.completionTokens;
          if (Number.isSafeInteger(value.promptTokens) && valid(value.promptTokens, 10_000_000)) message.metrics.promptTokens = value.promptTokens;
          if (valid(value.decodeTokensPerSecond, 10_000_000)) message.metrics.decodeTokensPerSecond = value.decodeTokensPerSecond;
        }
      }
      if (Array.isArray(candidate.steps)) message.steps = candidate.steps.filter((step): step is string => shortString(step, 80)).slice(0, 20);
      if (Array.isArray(candidate.attachments)) {
        const attachments: Attachment[] = [];
        for (const [index, file] of candidate.attachments.entries()) {
          if (!record(file) || typeof file.name !== "string" || typeof file.content !== "string" || attachments.length >= 3) { repaired++; continue; }
          attachments.push({ id: typeof file.id === "string" ? file.id : `${message.id}-attachment-${index}`, name: file.name, content: file.content, truncated: file.truncated === true });
        }
        if (attachments.length) message.attachments = attachments;
      }
      if (message.role === "assistant" && (candidate.pending === true || !message.content.trim())) {
        message.pending = false; message.stopped = true; repaired++;
        if (!message.content.trim()) message.content = (message.language || locale) === "de" ? "Antwort durch das Neuladen unterbrochen. Du kannst deine Frage erneut senden." : "Response interrupted by reloading. You can send your question again.";
      }
      messages.push(message);
    }
    const chat: Chat = { id: value.id, title: typeof value.title === "string" ? value.title : locale === "de" ? "Gespräch" : "Conversation", updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : 0, messages };
    if (value.pinned === true) chat.pinned = true;
    if (typeof value.projectId === "string" && projectIds.has(value.projectId)) chat.projectId = value.projectId;
    if (shortString(value.sourceChatId, 200) && value.sourceChatId !== value.id) chat.sourceChatId = value.sourceChatId;
    chats.push(chat);
  }
  return { chats, projects, activeProjectId: typeof data.activeProjectId === "string" && projectIds.has(data.activeProjectId) ? data.activeProjectId : null, activeId: typeof data.activeId === "string" && chatIds.has(data.activeId) ? data.activeId : null, locale, theme: data.theme === "light" ? "light" as const : "dark" as const, autoSpeak: data.autoSpeak === true, collapsed: data.collapsed === true, voiceId: typeof data.voiceId === "string" ? data.voiceId : "", repaired };
}
