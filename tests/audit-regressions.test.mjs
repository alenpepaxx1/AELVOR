// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { prepareConversation } from "../lib/conversation.ts";
import { CpuWorkerClient } from "../lib/cpu-worker-client.ts";
import { createCpuWorkerHandler } from "../lib/cpu-worker-protocol.ts";
import { defaultCpuModel, getCpuModel } from "../lib/cpu-models.ts";
import { conversationError } from "../lib/conversation-errors.ts";
import { assistantPreferencePrompt } from "../lib/assistant-preferences.ts";

test("a normal three-file phone question fits its prompt budget with explicitly shortened file excerpts", () => {
  const text = "Please compare these logs.";
  const files = ["server.log", "client.log", "events.log"].map(name => ({ name, content: "entry ".repeat(500) }));
  const result = prepareConversation({ text, files, locale: "en", characterBudget: 2400 });
  const current = result.messages.at(-1).content;
  assert.ok(current.startsWith(`${text}\n\n`)); assert.ok(current.length <= 2400); assert.equal(result.shortened, true);
  const records = current.split("\n").slice(3).map(line => JSON.parse(line));
  assert.deepEqual(records.map(item => item.filename), files.map(item => item.name));
  assert.ok(records.every(item => item.text.length > 0 && item.scope === "partial excerpt only"));
});

test("phone excerpts account for JSON escaping and preferences while preserving the complete question", () => {
  const text = "Compare the attached JSON and explain the difference.";
  const preferences = { style: "concise", instructions: "Use plain language. ".repeat(20) };
  const files = ["first.json", "second.json", "third.json"].map(name => ({ name, content: '\\"\n\t'.repeat(1200) }));
  for (const locale of ["en", "de"]) {
    const result = prepareConversation({ text, files, preferences, locale, characterBudget: 2400 });
    const current = result.messages.at(-1).content;
    assert.ok(current.startsWith(`${text}\n\n`));
    assert.ok(current.length + assistantPreferencePrompt(preferences).length <= 2400);
    assert.equal(current.split("\n").slice(3).map(line => JSON.parse(line)).length, 3);
    assert.equal(result.shortened, true);
  }
  assert.throws(() => prepareConversation({ text: "x".repeat(2401), files, locale: "en", characterBudget: 2400 }), /conversation_input_too_long/);
});

test("buffered CPU text is delivered before a later worker error instead of being lost", async () => {
  const worker = { onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(command) {
    if (command.type === "load") worker.onmessage({ data: { type: "ready", id: command.id, modelId: command.modelId, download: { weightBytes: getCpuModel(command.modelId).weightBytes, shardCount: 1, cachedShards: 0, cacheComplete: false, responseTested: true } } });
    else {
      for (const text of ["First ", "part."]) worker.onmessage({ data: { type: "chunk", id: command.id, chunk: { choices: [{ delta: { content: text } }] } } });
      worker.onmessage({ data: { type: "error", id: command.id, error: "cpu_inference_failed: interrupted backend" } });
    }
  } };
  const client = new CpuWorkerClient(worker, () => assert.fail("Unexpected fatal event"));
  try {
    await client.load(defaultCpuModel, 1, () => {});
    const iterator = (await client.adapter.stream([{ role: "user", content: "Hello" }]))[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value.choices[0].delta.content, "First ");
    assert.equal((await iterator.next()).value.choices[0].delta.content, "part.");
    await assert.rejects(iterator.next(), /interrupted backend/);
  } finally { client.dispose(); }
});

test("closing a waiting CPU iterator wakes its consumer without emitting cancelled text", async () => {
  let terminated = 0;
  const worker = { onmessage: null, onerror: null, onmessageerror: null, terminate() { terminated++; }, postMessage(command) {
    if (command.type === "load") worker.onmessage({ data: { type: "ready", id: command.id, modelId: command.modelId, download: { weightBytes: getCpuModel(command.modelId).weightBytes, shardCount: 1, cachedShards: 0, cacheComplete: false, responseTested: true } } });
  } };
  const client = new CpuWorkerClient(worker, () => assert.fail("Unexpected fatal event"));
  try {
    await client.load(defaultCpuModel, 1, () => {});
    const iterator = (await client.adapter.stream([{ role: "user", content: "Hello" }]))[Symbol.asyncIterator]();
    const pending = iterator.next();
    assert.equal((await iterator.return()).done, true);
    assert.equal((await pending).done, true);
    assert.equal((await iterator.next()).done, true);
    assert.equal(terminated, 1);
  } finally { client.dispose(); }
});

test("publisher access and network failures during CPU loading retain an actionable download category", async () => {
  for (const [message, expected] of [["Unauthorized access to file: https://huggingface.co/model", "cpu_download_denied"], ["Forbidden access to file: https://huggingface.co/model", "cpu_download_denied"], ["Error (401) occurred while trying to load file", "cpu_download_denied"], ["Could not locate file: https://huggingface.co/model", "cpu_download_missing"], ["HTTP 404", "cpu_download_missing"], ["Failed to fetch", "cpu_download_network"], ["Error (429) occurred while trying to load file", "cpu_download_network"], ["HTTP 503", "cpu_download_network"]]) {
    const replies = [];
    const handler = createCpuWorkerHandler(async () => { throw Error(message); }, reply => replies.push(reply));
    await handler({ type: "load", id: 1, modelId: defaultCpuModel, threads: 1 });
    assert.equal(replies.at(-1).error, expected);
    for (const locale of ["en", "de"]) assert.doesNotMatch(conversationError(replies.at(-1).error, locale), /CPU runtime could not|CPU-Runtime konnte/);
  }
});

test("CPU loading preserves cache, memory and context failures instead of misclassifying them as downloads", async () => {
  for (const [failure, expected] of [[new DOMException("Storage blocked", "SecurityError"), "model_download_cache_unavailable"], [Error("Array buffer allocation failed"), "cpu_memory: Array buffer allocation failed"], [Error("context window exceeded"), "context window exceeded"], [Error("model_download_size"), "model_download_size"]]) {
    const replies = [];
    const handler = createCpuWorkerHandler(async () => { throw failure; }, reply => replies.push(reply));
    await handler({ type: "load", id: 1, modelId: defaultCpuModel, threads: 1 });
    assert.equal(replies.at(-1).error, expected);
  }
});
