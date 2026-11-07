// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { restoreWorkspace } from "../lib/workspace-state.ts";

const chat = messages => ({ id: "chat", title: "My chat", updatedAt: 123, messages });
const message = (id, role, content, extra = {}) => ({ id, role, content, ...extra });

test("a refresh turns pending or legacy blank replies into stopped replies while preserving partial text", () => {
  const saved = { activeId: "chat", locale: "de", chats: [chat([message("u", "user", "Hallo"), message("p", "assistant", "Teilweise Antwort", { pending: true, model: "Qwen 1.5B" }), message("b", "assistant", "")])] };
  const restored = restoreWorkspace(saved);
  assert.equal(restored.activeId, "chat");
  assert.equal(restored.chats[0].messages[1].content, "Teilweise Antwort");
  assert.equal(restored.chats[0].messages[1].stopped, true);
  assert.equal(restored.chats[0].messages[1].pending, false);
  assert.equal(restored.chats[0].messages[2].stopped, true);
  assert.match(restored.chats[0].messages[2].content, /unterbrochen/);
  assert.equal(restored.repaired, 2);
});

test("malformed saved entries cannot crash rendering or discard neighboring valid conversations", () => {
  const restored = restoreWorkspace({ chats: [null, chat([null, message("a", "assistant", "A valid reply", { model: { bad: true }, language: [], kind: { bad: true }, steps: [null, "generate"] }), message("b", ["user"], "bad role")]), { id: "second", title: "Second", updatedAt: 124, messages: [message("c", "user", "Hello")] }] });
  assert.equal(restored.chats.length, 2);
  assert.equal(restored.chats[0].messages.length, 1);
  const kept = restored.chats[0].messages[0];
  assert.equal(kept.content, "A valid reply");
  assert.equal(kept.model, undefined); assert.equal(kept.kind, undefined); assert.equal(kept.language, undefined);
  assert.deepEqual(kept.steps, ["generate"]);
  assert.equal(restored.chats[1].title, "Second");
});

test("duplicate ids and malformed file entries are repaired without duplicate React keys", () => {
  const restored = restoreWorkspace({ chats: [chat([message("a", "user", "Review", { attachments: [null, { name: "one.txt", content: "file text" }] }), message("a", "assistant", "duplicate")]), chat([])] });
  assert.equal(restored.chats.length, 1);
  assert.equal(restored.chats[0].messages.length, 1);
  const attachment = restored.chats[0].messages[0].attachments[0];
  assert.equal(attachment.name, "one.txt"); assert.equal(typeof attachment.id, "string");
});

test("valid completed chats, voice preferences and saved flags survive restoration", () => {
  const restored = restoreWorkspace({ locale: "de", theme: "light", activeId: "chat", autoSpeak: true, collapsed: true, voiceId: "voice-de", chats: [chat([message("a", "assistant", "Completed", { model: "Qwen 1.5B", saved: true, pending: false, language: "de", finishReason: "length" })])] });
  assert.equal(restored.autoSpeak, true); assert.equal(restored.voiceId, "voice-de"); assert.equal(restored.theme, "light"); assert.equal(restored.locale, "de");
  assert.equal(restored.chats[0].messages[0].saved, true);
  assert.equal(restored.chats[0].messages[0].stopped, undefined);
  assert.equal(restored.chats[0].messages[0].finishReason, "length");
  assert.equal(restored.repaired, 0);
});

test("measured generation details survive refresh while invalid counters are discarded", () => {
  const restored = restoreWorkspace({ chats: [chat([message("metrics", "assistant", "Completed", { metrics: { elapsedMs: 500, firstTokenMs: 200, completionTokens: 20, promptTokens: 80, decodeTokensPerSecond: 30.5, contextRetries: 1 } }), message("invalid", "assistant", "Completed", { metrics: { elapsedMs: -1, firstTokenMs: NaN, contextRetries: 99 } })])] });
  assert.deepEqual(restored.chats[0].messages[0].metrics, { elapsedMs: 500, firstTokenMs: 200, completionTokens: 20, promptTokens: 80, decodeTokensPerSecond: 30.5, contextRetries: 1 });
  assert.equal(restored.chats[0].messages[1].metrics, undefined);
});
