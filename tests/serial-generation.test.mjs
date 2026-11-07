// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { AsyncMutex } from "../lib/async-mutex.ts";
import { serialGeneration } from "../lib/serial-generation.ts";

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = cleanup => ({ [Symbol.asyncIterator]() { return this; }, async next() { return { done: false, value: { choices: [{ delta: { content: "hi" } }] } }; }, async return() { await cleanup; return { done: true }; } });

test("the FIFO mutex removes cancelled waiters and releases each lease once", async () => {
  const mutex = new AsyncMutex(), signal = new AbortController();
  const first = await mutex.acquire();
  const second = mutex.acquire(signal.signal), cancelled = assert.rejects(second, error => error.name === "AbortError");
  const third = mutex.acquire(); signal.abort(); await cancelled;
  first(); first(); const release = await third; release();
  const final = await mutex.acquire(); final(); mutex.dispose();
  await assert.rejects(mutex.acquire(), /model_not_ready/);
});

test("a new request waits until the previous SDK iterator finishes cleanup", async () => {
  const cleanup = deferred(), controller = new AbortController(); let resets = 0;
  const runtime = serialGeneration({ reset: async () => { resets++; }, stream: async () => source(cleanup.promise), interrupt() {} });
  const first = await runtime.adapter.stream([], controller.signal);
  controller.abort(); const second = runtime.adapter.stream([]);
  await tick(); assert.equal(resets, 1);
  cleanup.resolve(); const next = await second; assert.equal(resets, 2);
  await next.return(); await first.return(); runtime.dispose();
});

test("cancellation during reset preserves ordering before a subsequent request", async () => {
  const reset = deferred(), controller = new AbortController(); let resets = 0;
  const runtime = serialGeneration({ reset: () => { resets++; return resets === 1 ? reset.promise : Promise.resolve(); }, stream: async () => source(), interrupt() {} });
  const first = runtime.adapter.stream([], controller.signal); await tick(); controller.abort();
  await assert.rejects(first, error => error.name === "AbortError");
  const second = runtime.adapter.stream([]); await tick(); assert.equal(resets, 1);
  reset.resolve(); const stream = await second; assert.equal(resets, 2); await stream.return(); runtime.dispose();
});

test("a stream that arrives after cancellation is closed before the next reset", async () => {
  const pending = deferred(), cleanup = deferred(), controller = new AbortController(); let resets = 0, calls = 0;
  const runtime = serialGeneration({ reset: async () => { resets++; }, stream: () => ++calls === 1 ? pending.promise : Promise.resolve(source()), interrupt() {} });
  const first = runtime.adapter.stream([], controller.signal); await tick(); controller.abort();
  await assert.rejects(first, error => error.name === "AbortError");
  const second = runtime.adapter.stream([]); pending.resolve(source(cleanup.promise)); await tick(); assert.equal(resets, 1);
  cleanup.resolve(); const stream = await second; assert.equal(resets, 2); await stream.return(); runtime.dispose();
});

test("disposing a runtime rejects queued requests instead of leaving them waiting", async () => {
  const runtime = serialGeneration({ reset: async () => {}, stream: async () => source(), interrupt() {} });
  const active = await runtime.adapter.stream([]); const queued = runtime.adapter.stream([]);
  runtime.dispose(); await assert.rejects(queued, /model_not_ready/); await active.return();
});
