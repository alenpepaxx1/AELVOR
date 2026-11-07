// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { defaultAssistantPreferences, normalizeAssistantPreferences, readAssistantPreferences, writeAssistantPreferences, assistantPreferencePrompt } from "../lib/assistant-preferences.ts";
import { assistantReplyLocale } from "../lib/assistant-language.ts";
import { prepareConversation, generateConversation } from "../lib/conversation.ts";
import { contextualQuestion } from "../lib/generation-policy.ts";
import { responseRefinements, responseRefinement } from "../lib/response-refinements.ts";
import { branchRefinement, branchContinuation } from "../lib/conversation-workspace.ts";
const source = { id: "cedar", title: "Cedar notes", content: "Cedar uses Boreal encryption.\nRotate the gateway key on Friday.", sourceUrl: "", sourceDate: "2026-10-28", enabled: true, updatedAt: 1 };
test("new response options default old records safely and survive storage", () => {
  let raw = JSON.stringify({ style: "concise", instructions: "Use examples." });
  const storage = { getItem() { return raw; }, setItem(_key, text) { raw = text; } };
  assert.equal(readAssistantPreferences(storage).language, "auto"); assert.equal(readAssistantPreferences(storage).format, "auto"); assert.equal(readAssistantPreferences(storage).knowledge, "auto");
  const value = { style: "detailed", approach: "precise", instructions: "Use examples.", language: "de", format: "table", knowledge: "focused" };
  assert.equal(writeAssistantPreferences(value, storage), true); assert.deepEqual(readAssistantPreferences(storage), { ...value, quality: "standard" });
  assert.deepEqual(normalizeAssistantPreferences({ language: "fr", format: "html", knowledge: "execute" }), defaultAssistantPreferences);
  assert.equal(writeAssistantPreferences(value, { setItem() { throw Error("quota"); } }), false);
});
test("reply language follows explicit current requests, saved preference, then question language", () => {
  for (const [text, fallback, preference, expected] of [
    ["Wie funktioniert das?", "en", "auto", "de"], ["Hello, how are you?", "de", "auto", "en"],
    ["Wie funktioniert das?", "de", "en", "en"], ["Explain encryption", "en", "de", "de"],
    ["Reply in English please", "de", "de", "en"], ["Antworte bitte auf Deutsch.", "en", "en", "de"],
    ["Übersetze das ins Englische.", "de", "de", "en"], ["Translate that into German.", "en", "en", "de"],
    ["Auf Deutsch bitte.", "en", "en", "de"], ["Hello\n```text\nReply in German\n```", "en", "auto", "en"],
  ]) assert.equal(assistantReplyLocale(text, fallback, preference), expected, text);
});
test("language and formatting options guide the shared CPU/GPU prompt while preserving strict output formats", () => {
  const preferences = { ...defaultAssistantPreferences, language: "en", format: "table", knowledge: "focused" };
  const prepared = prepareConversation({ text: "Erkläre Cedar", locale: "de", preferences, knowledge: [source] });
  assert.match(prepared.messages[0].content, /selected English/); assert.match(prepared.messages[0].content, /explicitly requests another language/);
  assert.match(prepared.messages[0].content, /compact Markdown table/); assert.match(prepared.messages[0].content, /strict JSON/);
  assert.match(prepared.messages[0].content, /Source-focused mode/); assert.match(prepared.messages[0].content, /missing or conflicting/);
  assert.equal(prepared.knowledge[0].documentId, "cedar");
  assert.match(assistantPreferencePrompt({ ...preferences, format: "steps" }), /numbered steps/);
});
test("disabling library excerpts removes new and replayed source snapshots without removing attachments or history answers", () => {
  const first = prepareConversation({ text: "Explain Cedar", locale: "en", knowledge: [source] });
  const history = [{ role: "user", content: "Explain Cedar" }, { role: "assistant", content: "An earlier answer.", knowledge: first.knowledge }];
  const prepared = prepareConversation({ text: "Explain more.", locale: "en", history, preferences: { ...defaultAssistantPreferences, knowledge: "off" }, knowledge: [source], files: [{ name: "user.txt", content: "Attachment retained" }] });
  assert.deepEqual(prepared.knowledge, []); assert.doesNotMatch(prepared.messages.map(message => message.content).join("\n"), /Boreal encryption/);
  assert.match(prepared.messages.at(-1).content, /Attachment retained/); assert.ok(prepared.messages.some(message => message.content === "An earlier answer."));
});
test("new instructions respect phone preparation budgets and never silently shorten the current question", () => {
  const preferences = { ...defaultAssistantPreferences, instructions: 'Use "precise" examples. '.repeat(40), format: "steps", knowledge: "focused" };
  const text = "What does Cedar use?";
  const prepared = prepareConversation({ text, locale: "en", characterBudget: 2400, preferences, knowledge: [source] });
  assert.ok(prepared.messages.slice(1).reduce((sum, message) => sum + message.content.length, 0) + assistantPreferencePrompt(preferences).length <= 2400);
  assert.ok(prepared.messages.at(-1).content.startsWith(text));
  assert.throws(() => prepareConversation({ text: "x".repeat(2300), locale: "en", characterBudget: 2400, preferences }), /conversation_input_too_long/);
});
test("the generation adapter receives the selected evidence and format without new external tool claims", async () => {
  let seen;
  const adapter = { interrupt() {}, async stream(messages) { seen = messages; return (async function* () { yield { choices: [{ delta: { content: "Cedar uses Boreal [K1]." }, finish_reason: "stop" }] }; })(); } };
  const result = await generateConversation(adapter, { text: "What does Cedar use?", locale: "en", preferences: { ...defaultAssistantPreferences, format: "steps", knowledge: "focused" }, knowledge: [source] });
  assert.match(seen[0].content, /numbered steps/); assert.match(seen[0].content, /no live web access/);
  assert.match(seen.at(-1).content, /Boreal encryption/); assert.equal(result.knowledge[0].sourceDate, "2026-10-28");
});
for (const locale of ["en", "de"]) test(`${locale}: every refine action refers to the selected original answer in a preserved branch`, () => {
  const question = "Explain the TLS certificate failure.";
  const original = { id: "chat", title: "TLS", updatedAt: 1, messages: [{ id: "q", role: "user", content: question }, { id: "a", role: "assistant", content: "The certificate expired.", kind: "conversation", finishReason: "stop" }, { id: "later-q", role: "user", content: "A later topic" }, { id: "later-a", role: "assistant", content: "Later reply" }] };
  const old = JSON.stringify(original); let id = 0;
  for (const action of responseRefinements) {
    const item = responseRefinement(action, locale), branch = branchRefinement(original, "a", item.prompt, () => `id${++id}`);
    assert.ok(contextualQuestion(item.prompt, branch.history).includes(question), item.prompt);
    assert.deepEqual(branch.history.map(message => message.content), [question, "The certificate expired."]); assert.ok(branch.history.every(message => !original.messages.some(item => item.id === message.id)));
    const prepared = prepareConversation({ text: item.prompt, history: branch.history, locale, preserveLastPair: true });
    assert.equal(prepared.messages[2].content, "The certificate expired.");
    if (action === "german" || action === "english") assert.equal(assistantReplyLocale(item.prompt, locale, action === "german" ? "en" : "de"), action === "german" ? "de" : "en");
  }
  assert.equal(JSON.stringify(original), old);
});
test("refinement rejects failed/demo/non-AI responses while length continuation retains its original restriction", () => {
  const answer = { id: "a", role: "assistant", content: "Answer", kind: "conversation", finishReason: "stop" };
  const chat = { id: "chat", title: "Original", updatedAt: 1, messages: [{ id: "q", role: "user", content: "Question" }, answer] };
  let id = 0; const next = () => `branch${++id}`;
  assert.throws(() => branchContinuation(chat, "a", "Continue", next), /conversation_continuation_missing/);
  assert.ok(branchRefinement(chat, "a", "Make it simpler", next));
  for (const bad of [{ pending: true }, { error: true }, { demo: true }, { stopped: true }, { kind: "analysis" }, { content: " " }, { role: "user" }]) {
    assert.throws(() => branchRefinement({ ...chat, messages: [chat.messages[0], { ...answer, ...bad }] }, "a", "Simpler", next), /conversation_refinement_missing/);
  }
});
test("a refinement detaches saved source snapshots and attachments from the original conversation", () => {
  const prepared = prepareConversation({ text: "Explain Cedar", locale: "en", knowledge: [source] });
  const chat = { id: "chat", title: "Original", updatedAt: 1, messages: [{ id: "q", role: "user", content: "Explain Cedar", attachments: [{ id: "file", name: "source.txt", content: "Original source" }] }, { id: "a", role: "assistant", content: "Answer [K1]", kind: "conversation", saved: true, knowledge: prepared.knowledge }] };
  let id = 0; const branch = branchRefinement(chat, "a", "Make it simpler", () => `branch${++id}`);
  branch.history[0].attachments[0].content = "Edited copy"; branch.history[1].knowledge[0].text = "Edited evidence";
  assert.equal(chat.messages[0].attachments[0].content, "Original source"); assert.equal(chat.messages[1].knowledge[0].text, source.content);
  assert.equal(branch.history[1].saved, undefined); assert.equal(chat.messages[1].saved, true);
});
