// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { ConversationSession } from "../lib/conversation-session.ts";
import { conversationModels } from "../lib/conversation.ts";

const first = conversationModels[0].id, second = conversationModels[1].id;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function runtime(modelId = first, adapter) {
  const state = { disposed: 0, interrupted: 0 };
  return { modelId, state, dispose() { state.disposed++; }, adapter: adapter || { interrupt() { state.interrupted++; }, async stream() { return (async function* () { yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] }; })(); } } };
}

test("the session exposes stable immutable snapshots and measured load progress", async () => {
  const model = runtime(); let states = [];
  const session = new ConversationSession({ load: async (id, options) => { options.onProgress({ progress: 0.5, text: "Loading weights" }); return model; } });
  assert.equal(session.getSnapshot(), session.getSnapshot());
  const unsubscribe = session.subscribe(() => states.push(session.getSnapshot()));
  await session.load(first);
  assert.equal(session.ready, true); assert.equal(session.getSnapshot().status, "ready");
  assert.ok(states.some(value => value.progress === 0.5));
  assert.ok(states.every(Object.isFrozen));
  unsubscribe(); const count = states.length; session.unload(); assert.equal(states.length, count);
});

test("download verification survives readiness and progress cannot regress or reach 100 percent while loading", async () => {
  const download = { weightBytes: 1234, shardCount: 2, cachedShards: 2, cacheComplete: true, responseTested: true };
  const states = [], model = { ...runtime(), download };
  const session = new ConversationSession({ load: async (_id, options) => {
    options.onProgress({ progress: 0.8, text: "Downloaded", download: { ...download, responseTested: false } });
    options.onProgress({ progress: 0, text: "GPU loading" });
    options.onProgress({ progress: 1, text: "Testing response" });
    return model;
  } });
  session.subscribe(() => states.push(session.getSnapshot())); await session.load(first);
  const loading = states.filter(state => state.status === "loading");
  assert.ok(loading.every(state => state.progress < 1));
  assert.ok(loading.every((state, index) => !index || state.progress >= loading[index - 1].progress));
  assert.equal(session.getSnapshot().download.responseTested, true);
  assert.equal(session.getSnapshot().progress, 1); session.unload();
});

test("a superseded model load cannot overwrite the new model and its late runtime is disposed", async () => {
  const pending = deferred(), old = runtime(first), next = runtime(second); let oldOptions;
  const session = new ConversationSession({ load: (id, options) => { if (id === first) { oldOptions = options; return pending.promise; } return Promise.resolve(next); } });
  const loading = session.load(first); const cancelled = assert.rejects(loading, error => error.name === "AbortError");
  await session.load(second); await cancelled;
  oldOptions.onProgress({ progress: 0.8, text: "Stale progress" }); pending.resolve(old); await tick();
  assert.equal(session.getSnapshot().modelId, second); assert.equal(session.getSnapshot().status, "ready");
  assert.equal(old.state.disposed, 1); session.unload();
});

test("the load watchdog covers a loader that never resolves", async () => {
  let signal;
  const session = new ConversationSession({ loadTimeoutMs: 10, load: (id, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(session.load(first), /model_load_timeout/);
  assert.equal(signal.aborted, true); assert.equal(session.getSnapshot().status, "error");
  assert.equal(session.getSnapshot().error, "model_load_timeout"); session.unload();
});

test("concurrent generations are rejected and normal completion returns to ready", async () => {
  const gate = deferred(); const model = runtime(first, { interrupt() {}, async stream() { await gate.promise; return (async function* () { yield { choices: [{ delta: { content: "Reply" } }] }; })(); } });
  const session = new ConversationSession({ load: async () => model }); await session.load(first);
  const reply = session.generate({ text: "Hello", locale: "en" });
  assert.equal(session.getSnapshot().status, "generating");
  await assert.rejects(session.generate({ text: "Second", locale: "en" }), /model_busy/);
  gate.resolve(); assert.equal((await reply).text, "Reply");
  assert.equal(session.getSnapshot().status, "ready"); session.unload();
});

test("user cancellation keeps the loaded model available for the next request", async () => {
  const controller = new AbortController(), model = runtime();
  const session = new ConversationSession({ load: async () => model }); await session.load(first);
  await assert.rejects(session.generate({ text: "Hello", locale: "en", signal: controller.signal, onText: () => controller.abort() }), error => error.name === "AbortError");
  assert.equal(session.ready, true); assert.equal(model.state.disposed, 0);
  assert.equal((await session.generate({ text: "Again", locale: "en" })).text, "Hello"); session.unload();
});

test("a stalled generation releases the failed model and gives an actionable state", async () => {
  const model = runtime(first, { interrupt() {}, stream: () => new Promise(() => {}) });
  const session = new ConversationSession({ stallTimeoutMs: 10, load: async () => model }); await session.load(first);
  await assert.rejects(session.generate({ text: "Hello", locale: "en" }), /generation_stalled/);
  assert.equal(session.getSnapshot().status, "error"); assert.equal(session.ready, false); assert.equal(model.state.disposed, 1); session.unload();
});

test("a fatal worker event aborts the active response and cannot affect a later model", async () => {
  let fatal;
  const model = runtime(first, { interrupt() {}, stream: () => new Promise(() => {}) });
  const session = new ConversationSession({ load: async (id, options) => { if (id === first) { fatal = options.onFatal; return model; } return runtime(second); } });
  await session.load(first); const response = session.generate({ text: "Hi", locale: "en" });
  fatal(); await assert.rejects(response, /model_worker_failed/);
  assert.equal(session.getSnapshot().status, "error");
  assert.equal(model.state.disposed, 1, "the failed runtime is disposed exactly once");
  await session.load(second); fatal();
  assert.equal(session.getSnapshot().status, "ready"); assert.equal(session.getSnapshot().modelId, second); session.unload();
});

test("unloading during generation discards late text and leaves the session idle", async () => {
  const pending = deferred(); const seen = [];
  const model = runtime(first, { interrupt() {}, async stream() { return (async function* () { await pending.promise; yield { choices: [{ delta: { content: "Late" } }] }; })(); } });
  const session = new ConversationSession({ load: async () => model }); await session.load(first);
  const response = session.generate({ text: "Hi", locale: "en", onText: value => seen.push(value) });
  await tick(); session.unload(); await assert.rejects(response, error => error.name === "AbortError");
  pending.resolve(); await tick(); assert.deepEqual(seen, []); assert.equal(session.getSnapshot().status, "idle");
});

test("a loader cannot mark a different model ready under the requested model identity", async () => {
  const wrong = runtime(second);
  const session = new ConversationSession({ load: async () => wrong });
  await assert.rejects(session.load(first), /model_identity_mismatch/);
  assert.equal(session.ready, false); assert.equal(wrong.state.disposed, 1); session.unload();
});
