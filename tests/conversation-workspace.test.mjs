// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { backupLimits, branchContinuation, branchQuestion, createConversationBackup, highlightedText, mergeConversationBackup, parseConversationBackup, questionForResponse, searchConversations, sortedConversations } from "../lib/conversation-workspace.ts";
import { prepareConversation } from "../lib/conversation.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";

const file = { id: "f1", name: "incident.log", content: "login denied from 192.0.2.1", truncated: true };
const sample = () => ({ id: "c1", title: "Security notes", updatedAt: 123, pinned: true, messages: [
  { id: "u1", role: "user", content: "Explain phishing", language: "en" },
  { id: "a1", role: "assistant", content: "Check the sender and avoid sharing credentials.", saved: true, kind: "conversation", model: "Qwen", metrics: { elapsedMs: 1000, firstTokenMs: 50, contextRetries: 0 } },
  { id: "u2", role: "user", content: "Review this log", attachments: [{ ...file }] },
  { id: "a2", role: "assistant", content: "There is one failed login.", saved: true },
  { id: "u3", role: "user", content: "This later message must stay out of a retry." },
  { id: "a3", role: "assistant", content: "Later response." },
] });
const ids = () => { let value = 0; return () => `new-${++value}`; };
const serialize = chats => JSON.stringify(createConversationBackup(chats, new Date("2026-01-01T00:00:00Z")));

test("continuing an older response retains that partial answer and excludes later turns and unsent files", () => {
  const original = sample(); original.messages[3].finishReason = "length";
  const snapshot = JSON.stringify(original);
  const continuation = branchContinuation(original, "a2", "Continue your previous answer.", ids());
  assert.equal(continuation.history.length, 4);
  assert.equal(continuation.history.at(-1).content, "There is one failed login.");
  assert.equal(continuation.question.attachments, undefined);
  assert.equal(continuation.chat.sourceChatId, original.id);
  assert.ok(continuation.history.every(message => !message.saved));
  const prepared = prepareConversation({ text: continuation.question.content, history: continuation.history, locale: "en", preserveLastPair: true });
  assert.equal(prepared.messages.at(-2).content, "There is one failed login.");
  assert.ok(!JSON.stringify(prepared.messages).includes("Later response"));
  assert.equal(JSON.stringify(original), snapshot);
});

test("continuations reject stale, stopped, empty or unrelated responses before creating a branch", () => {
  for (const patch of [{ pending: true }, { stopped: true }, { error: true }, { demo: true }, { content: "" }, { finishReason: "stop" }]) {
    const chat = sample(); Object.assign(chat.messages[3], { finishReason: "length" }, patch);
    assert.throws(() => branchContinuation(chat, "a2", "Continue", ids()), /conversation_continuation_missing/);
  }
  assert.throws(() => branchContinuation(sample(), "missing", "Continue", ids()), /conversation_continuation_missing/);
});

test("portable conversation backups round-trip messages, pins, saved answers, metrics and text attachments", () => {
  const chat = sample(), data = parseConversationBackup(serialize([chat]));
  assert.equal(data.backup.format, "aelvor-conversations"); assert.equal(data.backup.version, 1);
  assert.match(data.backup.copyright, /Alen Pepa/);
  assert.deepEqual(data.backup.chats[0], restoreWorkspace({ chats: [chat] }).chats[0]);
  assert.equal(data.messages, 6); assert.equal(data.recovered, 0);
  assert.ok(!serialize([chat]).includes("model_list"), "no runtime or model weights are exported");
});

test("export snapshots an interrupted reply without mutating an active generation", () => {
  const chat = sample(); chat.messages.at(-1).pending = true;
  const backup = createConversationBackup([chat]);
  assert.equal(chat.messages.at(-1).pending, true); assert.equal(chat.messages.at(-1).stopped, undefined);
  assert.equal(backup.chats[0].messages.at(-1).pending, false); assert.equal(backup.chats[0].messages.at(-1).stopped, true);
  const data = JSON.parse(serialize([sample()])); data.chats[0].messages.at(-1).pending = true;
  const restored = parseConversationBackup(JSON.stringify(data));
  assert.equal(restored.recovered, 1); assert.equal(restored.backup.chats[0].messages.at(-1).stopped, true);
});

test("backup import rejects other formats, hidden trusted roles, broken records and duplicate identities", () => {
  assert.throws(() => parseConversationBackup("{"), /backup_invalid_json/);
  for (const change of [
    value => value.format = "classifier-model",
    value => value.version = 99,
    value => value.chats.push(value.chats[0]),
    value => value.chats[0].messages.push(value.chats[0].messages[0]),
    value => value.chats[0].messages[0].role = "system",
    value => value.chats[0].messages[0].content = { invalid: true },
    value => value.chats[0].messages[2].attachments.push(null),
    value => value.chats[0].updatedAt = null,
  ]) {
    const value = JSON.parse(serialize([sample()])); change(value);
    assert.throws(() => parseConversationBackup(JSON.stringify(value)), /backup_invalid_format/);
  }
  assert.throws(() => parseConversationBackup(" ".repeat(backupLimits.bytes + 1)), /backup_too_large/);
});

test("imports preserve colliding conversations and assign unique chat, message and attachment ids", () => {
  const original = sample(), incoming = sample(); incoming.messages[0].content = "A different question";
  const originalCopy = JSON.stringify(original), backup = parseConversationBackup(serialize([incoming])).backup;
  const merged = mergeConversationBackup([original], backup, ids());
  assert.equal(merged.added, 1); assert.equal(merged.skipped, 0); assert.equal(merged.chats.length, 2);
  assert.equal(merged.chats[0], original); assert.equal(JSON.stringify(original), originalCopy);
  const keys = merged.chats.flatMap(chat => [chat.id, ...chat.messages.flatMap(message => [message.id, ...(message.attachments || []).map(file => file.id)])]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(merged.chats[1].messages[2].attachments[0].content, file.content);
});

test("reimporting an identical backup is idempotent even after its ids were remapped", () => {
  const backup = parseConversationBackup(serialize([sample()])).backup;
  const first = mergeConversationBackup([], backup, ids());
  const second = mergeConversationBackup(first.chats, backup, ids());
  assert.equal(second.added, 0); assert.equal(second.skipped, 1); assert.equal(second.chats.length, 1);
  const renamed = { ...first.chats[0], title: "New name" };
  assert.equal(mergeConversationBackup([renamed], backup, ids()).added, 1, "a changed conversation is preserved separately");
});

test("imports remap branch parents, including parents skipped as identical copies", () => {
  const parent = sample(), child = { ...sample(), id: "child", sourceChatId: parent.id, title: "A branch" };
  const merged = mergeConversationBackup([parent], parseConversationBackup(serialize([child, parent])).backup, ids());
  assert.equal(merged.skipped, 1); assert.equal(merged.chats[1].sourceChatId, parent.id);
  const allNew = mergeConversationBackup([], parseConversationBackup(serialize([child, parent])).backup, ids());
  assert.equal(allNew.chats[0].sourceChatId, allNew.chats[1].id);
});

test("branching an earlier question preserves the original and copies only the prefix and that question", () => {
  const original = sample(), before = JSON.stringify(original);
  const branch = branchQuestion(original, "u2", "Review only the failed login", ids(), 456);
  assert.equal(JSON.stringify(original), before);
  assert.equal(branch.chat.sourceChatId, original.id); assert.equal(branch.chat.updatedAt, 456);
  assert.equal(branch.history.length, 2); assert.equal(branch.chat.messages.length, 3);
  assert.equal(branch.question.content, "Review only the failed login");
  assert.ok(branch.chat.messages.every(message => !message.saved));
  assert.ok(!JSON.stringify(branch.chat).includes("Later response"));
  assert.notEqual(branch.question.attachments[0].id, file.id);
  branch.question.attachments[0].content = "changed branch";
  assert.equal(original.messages[2].attachments[0].content, file.content);
  const prompt = prepareConversation({ text: branch.question.content, files: branch.question.attachments, history: branch.history, locale: "en" });
  assert.equal(prompt.messages.at(-1).role, "user");
  assert.ok(!JSON.stringify(prompt.messages).includes("Later response"));
  assert.ok(!JSON.stringify(prompt.messages).includes("There is one failed login"));
});

test("retry locates the response's own question and edited questions discard stale flags", () => {
  const chat = sample();
  assert.equal(questionForResponse(chat, "a2").id, "u2");
  assert.equal(questionForResponse(chat, "a1").id, "u1");
  assert.equal(questionForResponse(chat, "missing"), undefined);
  assert.equal(questionForResponse({ ...chat, messages: [chat.messages[1]] }, "a1"), undefined);
  chat.messages[2].demo = true; chat.messages[2].error = true;
  const branch = branchQuestion(chat, "u2", "Real revised question", ids());
  assert.equal(branch.question.demo, undefined); assert.equal(branch.question.error, undefined);
  assert.throws(() => branchQuestion(chat, "a2", "New text", ids()), /conversation_question_missing/);
});

test("pinned sorting survives persistence and never mutates the stored order", () => {
  const old = sample(), recent = { ...sample(), id: "recent", pinned: false, updatedAt: 999 };
  const chats = [recent, old], restored = restoreWorkspace({ chats });
  assert.equal(sortedConversations(restored.chats)[0].id, old.id);
  assert.equal(chats[0].id, "recent");
  assert.equal(sortedConversations([{ ...old, pinned: false }, recent])[0].id, "recent");
});

test("search finds the matching message and attachment text, with case-insensitive English/German terms", () => {
  const chat = sample(); chat.messages[3].content = "Überprüfe die Anmeldung und aktiviere MFA.";
  const german = searchConversations([chat], "ÜBERPRÜFE MFA");
  assert.equal(german[0].messageId, "a2"); assert.match(german[0].snippet, /Anmeldung/);
  const attached = searchConversations([chat], "192.0.2.1");
  assert.equal(attached[0].messageId, "u2"); assert.match(attached[0].snippet, /192\.0\.2\.1/);
  assert.equal(searchConversations([chat], "does-not-exist").length, 0);
});

test("saved and pinned search filters do not match unsaved text or unrelated chats", () => {
  const one = sample(), two = { ...sample(), id: "two", title: "Second", pinned: false };
  assert.equal(searchConversations([one, two], "", "pinned").length, 1);
  assert.equal(searchConversations([one], "phishing", "saved").length, 0, "a saved filter searches saved messages and titles only");
  assert.equal(searchConversations([one], "credentials", "saved")[0].messageId, "a1");
  assert.equal(searchConversations([one, two], "", "all", 1).length, 1);
});

test("search ranks title matches and creates a bounded snippet around long-text matches", () => {
  const title = { ...sample(), id: "title", title: "Phishing guide" };
  const body = { ...sample(), id: "body", pinned: false, updatedAt: 999 };
  assert.equal(searchConversations([body, title], "phishing")[0].chat.id, "title");
  body.messages[3].content = `${"start ".repeat(100)}unique-marker ${"end ".repeat(100)}`;
  const result = searchConversations([body], "unique-marker")[0];
  assert.match(result.snippet, /unique-marker/); assert.ok(result.snippet.length <= 192); assert.equal(result.messageId, "a2");
});

test("highlighting treats markup and regex characters as text, without changing content", () => {
  for (const [text, query] of [["Use [a+b] literally", "[a+b]"], ["<img src=x onerror=alert(1)>", "<img"], ["Überprüfe die MFA", "MFA ÜBERPRÜFE"], ["Everything stays plain", ""]]) {
    const parts = highlightedText(text, query);
    assert.equal(parts.map(part => part.text).join(""), text);
    if (query) assert.ok(parts.some(part => part.match));
    else assert.ok(parts.every(part => !part.match));
  }
});
