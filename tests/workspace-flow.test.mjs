// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { playbookRequest } from "../lib/templates.ts";
import { runLocalAgent } from "../lib/local-agent.ts";
import { extractArtifacts, formatJson, hashSha256, inspectUrl, extractIndicators } from "../lib/local-tools.ts";
import { branchQuestion, branchContinuation, createConversationBackup, mergeConversationBackup, parseConversationBackup, searchConversations } from "../lib/conversation-workspace.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";
import { readUserProfile, saveUserProfile } from "../lib/user-profile.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { withModelResources } from "../lib/model-load-gate.ts";

test("the local workspace flows from first profile through bilingual tools, branching, backup and reload without networking", async () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No network allowed"); };
  let sequence = 0; const id = () => `flow-${++sequence}`;
  try {
    assert.equal(readUserProfile(storage), null); saveUserProfile("Jörg.dev", storage);
    let chats = [];
    for (const locale of ["en", "de"]) {
      const request = playbookRequest("script", locale); assert.equal(request.engine, "tools");
      const reply = await runLocalAgent({ text: request.text, mode: request.mode, locale });
      const chat = { id: id(), title: `${locale} script`, updatedAt: 100 + chats.length, pinned: true, messages: [{ id: id(), role: "user", content: request.text, language: locale }, { id: id(), role: "assistant", content: reply.text, kind: reply.kind, language: locale, local: true, saved: true }] };
      const artifacts = extractArtifacts(chat.messages);
      assert.ok(artifacts.some(file => file.filename.endsWith(".py") && file.content.includes("Alen Pepa")));
      const edit = playbookRequest("review", locale);
      const branch = branchQuestion(chat, chat.messages[0].id, edit.text, id);
      const reviewed = await runLocalAgent({ text: branch.question.content, history: branch.history, mode: edit.mode, locale });
      branch.chat.messages.push({ id: id(), role: "assistant", content: reviewed.text, local: true, kind: reviewed.kind });
      assert.equal(reviewed.kind, "analysis"); assert.equal(chat.messages.length, 2);
      chats.push(chat, branch.chat);
    }
    assert.equal(inspectUrl("https://example.org/path").host, "example.org");
    assert.equal(extractIndicators("src=192.0.2.4").ipv4[0], "192.0.2.4");
    assert.deepEqual(JSON.parse(formatJson('{"ok":true}')), { ok: true });
    assert.equal(await hashSha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.notEqual(await hashSha256(" "), await hashSha256(""));
    const backup = parseConversationBackup(JSON.stringify(createConversationBackup(chats))).backup;
    const imported = mergeConversationBackup([], backup, id);
    assert.equal(imported.added, 4); assert.equal(mergeConversationBackup(imported.chats, backup, id).added, 0);
    storage.setItem("aegis-workspace-v1", JSON.stringify({ chats: imported.chats, activeId: imported.chats[0].id, locale: "de" }));
    const reloaded = restoreWorkspace(JSON.parse(storage.getItem("aegis-workspace-v1")));
    assert.equal(reloaded.chats.length, 4); assert.equal(reloaded.locale, "de");
    assert.equal(reloaded.chats.flatMap(chat => chat.messages).filter(message => message.saved).length, 2);
    assert.equal(searchConversations(reloaded.chats, "SQL").length, 2);
    assert.equal(readUserProfile(storage).username, "Jörg.dev");
  } finally { globalThis.fetch = oldFetch; }
});

test("a fixture AI runtime passes the resource gate, streams, continues the selected answer and survives backup", async () => {
  // This exercises the complete application protocol with fixture generation;
  // it intentionally makes no claim about a real GPU or model-answer quality.
  const model = getConversationModel("Qwen2.5-0.5B-Instruct-q4f32_1-MLC");
  const device = { checkedAt: Date.now(), cpuThreads: 8, ramEstimateGB: 16, gpu: "available", gpuName: "Fixture GPU", features: ["shader-f16"], maxBufferBytes: 2 ** 30, maxStorageBufferBytes: 2 ** 30, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 20, workerAvailable: true };
  const prompts = []; let streams = 0, disposed = 0;
  const session = new ConversationSession({ load: (modelId, options) => withModelResources(model, { ...options, inspect: async () => device }, async () => ({ modelId, dispose() { disposed++; }, adapter: { interrupt() {}, async stream(messages) { prompts.push(messages); streams++; return (async function* () { yield { choices: [{ delta: { content: streams === 1 ? "Erster Teil." : "Zweiter Teil." }, finish_reason: streams === 1 ? "length" : "stop" }] }; })(); } } })) });
  try {
    await session.load(model.id); assert.equal(session.ready, true);
    const partial = []; const reply = await session.generate({ text: "Erkläre Zero Trust", locale: "de", onText: value => partial.push(value) });
    assert.equal(partial.at(-1), "Erster Teil."); assert.equal(reply.finishReason, "length");
    const chat = { id: "ai-chat", title: "Zero Trust", updatedAt: 1, messages: [{ id: "q", role: "user", content: "Erkläre Zero Trust" }, { id: "a", role: "assistant", content: reply.text, finishReason: reply.finishReason, metrics: reply.metrics }] };
    let sequence = 0; const branch = branchContinuation(chat, "a", "Setze deine Antwort fort.", () => `continued-${++sequence}`);
    const continued = await session.generate({ text: branch.question.content, history: branch.history, locale: "de", preserveLastPair: true });
    assert.equal(prompts.at(-1).at(-2).content, reply.text); assert.equal(continued.finishReason, "stop");
    branch.chat.messages.push({ id: "continuation-result", role: "assistant", content: continued.text, finishReason: continued.finishReason, metrics: continued.metrics });
    const restored = parseConversationBackup(JSON.stringify(createConversationBackup([chat, branch.chat]))).backup.chats;
    assert.equal(restored[1].messages.at(-1).content, "Zweiter Teil.");
    assert.equal(restored[1].messages.at(-1).metrics.contextRetries, 0);
    assert.equal(session.getSnapshot().status, "ready");
  } finally { session.unload(); }
  assert.equal(disposed, 1); assert.equal(session.ready, false);
});
