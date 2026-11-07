// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { saveProject, removeProject, restoreProjects } from "../lib/projects.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";
import { createConversationBackup, parseConversationBackup, mergeConversationBackup, branchQuestion, branchContinuation, searchConversations } from "../lib/conversation-workspace.ts";
import { DraftAutosave, readDrafts, writeDrafts, updateDraft, removeDraft, draftsStorageKey } from "../lib/drafts.ts";
import { normalizeAssistantPreferences, assistantPreferencePrompt, readAssistantPreferences, writeAssistantPreferences } from "../lib/assistant-preferences.ts";
import { prepareConversation, generateConversation } from "../lib/conversation.ts";

const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const chat = () => ({ id: "chat", title: "Research", updatedAt: 1, pinned: true, projectId: "project", messages: [{ id: "question", role: "user", content: "Explain MFA" }, { id: "answer", role: "assistant", content: "Use multiple factors.", saved: true, finishReason: "length" }] });
const newIds = () => { let counter = 0; return () => `new-${++counter}`; };
const file = { id: "file", name: "example.log", content: "failed login", truncated: false };

test("projects normalize names, prevent duplicates, and can be removed without deleting chats or bookmarks", () => {
  let projects = saveProject([], "  Security   research  ", "project");
  assert.equal(projects[0].name, "Security research");
  assert.throws(() => saveProject(projects, "security research", "different"), /project_duplicate/);
  projects = saveProject(projects, "Research", "project"); assert.equal(projects.length, 1);
  const original = chat(), removed = removeProject(projects, [original], "project");
  assert.equal(removed.projects.length, 0); assert.equal(removed.chats.length, 1);
  assert.equal(removed.chats[0].projectId, undefined); assert.equal(removed.chats[0].messages[1].saved, true);
  assert.equal(original.projectId, "project");
});

test("workspace restoration reads legacy history and discards invalid project references safely", () => {
  const legacy = restoreWorkspace({ chats: [chat()] });
  assert.equal(legacy.chats[0].projectId, undefined); assert.deepEqual(legacy.projects, []);
  const restored = restoreWorkspace({ chats: [chat()], projects: [{ id: "project", name: "Research" }], activeProjectId: "project" });
  assert.equal(restored.activeProjectId, "project"); assert.equal(restored.chats[0].projectId, "project");
  assert.equal(restoreProjects([{ id: "a", name: "Research" }, { id: "a", name: "Other" }, { id: "b", name: "research" }, null]).length, 1);
});

test("project backups remap collisions, reuse matching projects and remain idempotent", () => {
  const incoming = [{ id: "project", name: "Research" }], existing = [{ id: "kept-project", name: "research" }];
  const backup = parseConversationBackup(JSON.stringify(createConversationBackup([chat()], new Date(), incoming))).backup;
  assert.equal(backup.chats[0].projectId, "project");
  const merged = mergeConversationBackup([], backup, newIds(), existing);
  assert.equal(merged.projects.length, 1); assert.equal(merged.projectsAdded, 0);
  assert.equal(merged.chats[0].projectId, "kept-project");
  const twice = mergeConversationBackup(merged.chats, backup, newIds(), merged.projects);
  assert.equal(twice.added, 0); assert.equal(twice.skipped, 1);
  const empty = parseConversationBackup(JSON.stringify(createConversationBackup([], new Date(), incoming))).backup;
  assert.equal(mergeConversationBackup([], empty, newIds()).projectsAdded, 1);
});

test("branches retain project membership and project names participate in search", () => {
  const source = chat(), question = branchQuestion(source, "question", "A new question", newIds());
  const continuation = branchContinuation(source, "answer", "Continue", newIds());
  assert.equal(question.chat.projectId, "project"); assert.equal(continuation.chat.projectId, "project");
  assert.equal(searchConversations([source], "Sicherheitslabor", "all", 50, [{ id: "project", name: "Sicherheitslabor" }])[0].chat.id, source.id);
  const bad = createConversationBackup([], new Date(), [{ id: "p", name: "Good" }]); bad.projects.push({ id: "p", name: "Duplicate" });
  assert.throws(() => parseConversationBackup(JSON.stringify(bad)), /backup_invalid_format/);
});

test("drafts survive switching and reload with files, modes and engines, and sending removes only that draft", () => {
  const saved = storage();
  let drafts = updateDraft([], "chat", { text: "Unsent question", attachments: [file], mode: "investigate", engine: "tools" }, 1);
  drafts = updateDraft(drafts, null, { text: "New conversation draft", attachments: [], mode: "learn", engine: "chat" }, 2);
  assert.equal(writeDrafts(drafts, saved), true);
  const restored = readDrafts(new Set(["chat"]), saved);
  assert.equal(restored.find(item => item.chatId === "chat").attachments[0].content, file.content);
  assert.equal(restored.find(item => item.chatId === "chat").engine, "tools");
  const sent = removeDraft(restored, "chat"); writeDrafts(sent, saved);
  assert.equal(readDrafts(new Set(["chat"]), saved).length, 1);
  assert.equal(readDrafts(new Set(["chat"]), saved)[0].chatId, null);
});

test("late timer and page lifecycle saves cannot resurrect a sent, discarded or deleted draft", () => {
  for (const action of ["send", "discard", "delete", "clear history"]) {
    const saved = storage(), autosave = new DraftAutosave();
    const value = { text: "Do not resurrect this question", attachments: [file], mode: "investigate", engine: "tools" };
    let drafts = updateDraft([], "chat", value);
    drafts = updateDraft(drafts, null, { ...value, text: "Keep the unrelated draft" });
    const staleSave = autosave.createSave(() => { drafts = updateDraft(drafts, "chat", value); writeDrafts(drafts, saved); });
    autosave.invalidate();
    drafts = action === "clear history" ? [] : removeDraft(drafts, "chat"); writeDrafts(drafts, saved);
    // Invoke callbacks directly to cover the interval before effect cleanup,
    // regardless of how a browser orders its timeout and page lifecycle events.
    staleSave(); staleSave(); staleSave();
    const restored = readDrafts(new Set(["chat"]), saved);
    assert.equal(restored.some(draft => draft.chatId === "chat"), false, action);
    assert.equal(restored.length, action === "clear history" ? 0 : 1, action);
  }
});

test("switching composers preserves the latest draft and subsequent autosaves stay active", () => {
  const saved = storage(), autosave = new DraftAutosave();
  const old = { text: "Earlier text", attachments: [], mode: "auto", engine: "chat" };
  let drafts = [];
  const staleSave = autosave.createSave(() => { drafts = updateDraft(drafts, "chat", old); writeDrafts(drafts, saved); });
  autosave.invalidate();
  drafts = updateDraft(drafts, "chat", { ...old, text: "Latest text", attachments: [file] }); writeDrafts(drafts, saved);
  const newSave = autosave.createSave(() => { drafts = updateDraft(drafts, null, { ...old, text: "A new question" }); writeDrafts(drafts, saved); });
  newSave(); staleSave(); newSave();
  const restored = readDrafts(new Set(["chat"]), saved);
  assert.equal(restored.find(draft => draft.chatId === "chat").text, "Latest text");
  assert.equal(restored.find(draft => draft.chatId === "chat").attachments[0].content, file.content);
  assert.equal(restored.find(draft => draft.chatId === null).text, "A new question");
});

test("draft recovery ignores orphaned and malformed data and empty drafts are removed", () => {
  const saved = storage();
  const draft = { chatId: "chat", text: "pending", attachments: [], mode: "auto", engine: "chat", updatedAt: 1 };
  saved.setItem(draftsStorageKey, JSON.stringify({ version: 1, drafts: [draft, { ...draft, chatId: "orphan" }, { ...draft, chatId: null, attachments: [null] }] }));
  assert.equal(readDrafts(new Set(["chat"]), saved).length, 1);
  assert.equal(updateDraft([draft], "chat", { text: "", attachments: [], mode: "auto", engine: "chat" }).length, 0);
  assert.equal(writeDrafts([draft], { setItem() { throw Error("Storage full"); } }), false);
  assert.deepEqual(readDrafts(new Set(), { getItem() { throw Error("Storage denied"); } }), []);
});

test("oversized serialized draft sets cannot replace a readable saved draft", () => {
  const saved = storage(), value = { text: "Keep this text", attachments: [], mode: "auto", engine: "chat" };
  const original = updateDraft([], "chat", value); writeDrafts(original, saved);
  const large = Array.from({ length: 50 }, (_, index) => ({ chatId: `chat-${index}`, text: "\\".repeat(20_000), attachments: [0, 1, 2].map(number => ({ ...file, id: `file-${number}`, content: "\\".repeat(12_000) })), mode: "auto", engine: "chat", updatedAt: index }));
  assert.equal(writeDrafts(large, saved), false);
  assert.equal(readDrafts(new Set(["chat"]), saved)[0].text, "Keep this text");
});

test("project membership, a file draft and AI preferences survive an integrated workspace reload", () => {
  const saved = storage(), projects = [{ id: "project", name: "Incident research" }];
  const imported = mergeConversationBackup([], parseConversationBackup(JSON.stringify(createConversationBackup([chat()], new Date(), projects))).backup, newIds());
  const target = imported.chats[0];
  saved.setItem("workspace", JSON.stringify({ chats: imported.chats, projects: imported.projects, activeProjectId: target.projectId, activeId: target.id }));
  writeDrafts(updateDraft([], target.id, { text: "Next question", attachments: [file], mode: "investigate", engine: "chat" }), saved);
  writeAssistantPreferences({ style: "detailed", instructions: "Explain the evidence." }, saved);
  const restored = restoreWorkspace(JSON.parse(saved.getItem("workspace")));
  const draft = readDrafts(new Set(restored.chats.map(chat => chat.id)), saved)[0];
  const prompt = prepareConversation({ text: draft.text, files: draft.attachments, locale: "en", preferences: readAssistantPreferences(saved) });
  assert.equal(restored.projects[0].id, restored.chats[0].projectId);
  assert.equal(draft.chatId, restored.activeId); assert.match(prompt.messages.at(-1).content, /failed login/);
  assert.match(prompt.messages[0].content, /Explain the evidence/);
});

test("assistant preferences persist locally with validated style and bounded quoted instructions", () => {
  const saved = storage(), input = { style: "concise", instructions: "Explain in simple German." };
  assert.equal(writeAssistantPreferences(input, saved), true); assert.deepEqual(readAssistantPreferences(saved), { ...input, approach: "auto", language: "auto", format: "auto", knowledge: "auto", quality: "standard" });
  assert.equal(normalizeAssistantPreferences({ style: "unknown", instructions: "x".repeat(2000) }).instructions.length, 1000);
  assert.equal(normalizeAssistantPreferences({ style: "unknown" }).style, "balanced");
  assert.equal(writeAssistantPreferences(input, { setItem() { throw Error("Denied"); } }), false);
  assert.equal(assistantPreferencePrompt().length, 0);
});

test("a failed preferences save can retry the same value and recover without changing history", () => {
  const saved = storage(), input = { style: "detailed", instructions: "  Explain in German.  " };
  saved.setItem("aegis-workspace-v1", "existing history");
  writeAssistantPreferences({ style: "concise", instructions: "Previous preferences" }, saved);
  const rejected = { setItem() { throw new DOMException("Full", "QuotaExceededError"); } };
  assert.equal(writeAssistantPreferences(input, rejected), false);
  assert.equal(readAssistantPreferences(saved).instructions, "Previous preferences");
  assert.match(assistantPreferencePrompt(input), /Explain in German/);
  assert.equal(writeAssistantPreferences(input, saved), true);
  assert.deepEqual(readAssistantPreferences(saved), { style: "detailed", instructions: "Explain in German.", approach: "auto", language: "auto", format: "auto", knowledge: "auto", quality: "standard" });
  assert.equal(saved.getItem("aegis-workspace-v1"), "existing history");
});

test("personalized prompts retain core identity, code attribution and a single system role", () => {
  const preferences = { style: "detailed", instructions: 'Use examples.\nQuoted text: "hello"' };
  const result = prepareConversation({ text: "Erkläre MFA", locale: "de", preferences });
  assert.equal(result.messages.filter(message => message.role === "system").length, 1);
  assert.match(result.messages[0].content, /structured, detailed/);
  assert.match(result.messages[0].content, /Alen Pepa/); assert.match(result.messages[0].content, /no live web access/);
  assert.ok(result.messages[0].content.includes(JSON.stringify(preferences.instructions)));
  assert.equal(result.messages.at(-1).content, "Erkläre MFA");
  assert.throws(() => prepareConversation({ text: "q".repeat(5900), locale: "en", preferences: { style: "concise", instructions: "x".repeat(1000) } }), /conversation_input_too_long/);
});

test("preferences reach streamed generation without changing the user's question", async () => {
  let prompt;
  const adapter = { interrupt() {}, async stream(messages) { prompt = messages; return (async function* () { yield { choices: [{ delta: { content: "A concise answer." }, finish_reason: "stop" }] }; })(); } };
  const result = await generateConversation(adapter, { text: "Explain MFA", locale: "en", preferences: { style: "concise", instructions: "Use everyday language." } });
  assert.match(result.text, /concise answer/); assert.match(prompt[0].content, /Keep the response concise/);
  assert.equal(prompt.at(-1).content, "Explain MFA");
});
