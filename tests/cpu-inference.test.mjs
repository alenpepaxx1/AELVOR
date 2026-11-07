// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { inspectCpuExecution, inspectDevice, gpuVendor, assessModel } from "../lib/device-capabilities.ts";
import { cpuModels, getCpuModel, cpuModelBaseUrl, assessCpuModel, requireCpuResources } from "../lib/cpu-models.ts";
import { getChatModel } from "../lib/chat-models.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { isConversationModel, generateConversation } from "../lib/conversation.ts";
import { verifiedCpuCache, clearCpuCache, cpuCacheName, validateCpuFile } from "../lib/cpu-cache.ts";
import { createCpuWorkerHandler } from "../lib/cpu-worker-protocol.ts";
import { CpuWorkerClient } from "../lib/cpu-worker-client.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { conversationError } from "../lib/conversation-errors.ts";

const model = cpuModels[0];
const device = () => ({ checkedAt: Date.now(), cpuThreads: 8, ramEstimateGB: 16, cpu: { wasm: true, simd: true, threads: 1 }, gpu: "unavailable", gpuName: "", features: [], maxBufferBytes: null, maxStorageBufferBytes: null, maxComputeWorkgroupStorageBytes: null, maxStorageBuffersPerStage: null, cacheAvailableGB: 20, workerAvailable: true });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("CPU execution probes actual WASM/SIMD and uses threads only with browser isolation", () => {
  assert.deepEqual(inspectCpuExecution(16, { WebAssembly, crossOriginIsolated: false, SharedArrayBuffer }), { wasm: true, simd: true, threads: 1 });
  assert.equal(inspectCpuExecution(32, { WebAssembly, crossOriginIsolated: true, SharedArrayBuffer }).threads, 8);
  assert.equal(inspectCpuExecution(2, { WebAssembly, crossOriginIsolated: true, SharedArrayBuffer }).threads, 2);
  assert.equal(inspectCpuExecution(null, { WebAssembly, crossOriginIsolated: true, SharedArrayBuffer }).threads, 1);
  assert.equal(inspectCpuExecution(8, {}).wasm, false);
  const noSimd = { validate: bytes => bytes.length === 8 };
  assert.deepEqual(inspectCpuExecution(8, { WebAssembly: noSimd }), { wasm: true, simd: false, threads: 1 });
});

test("CPU inference works through the resource gate without a GPU and rejects missing capabilities or RAM", () => {
  assert.equal(assessCpuModel(model, device()).status, "caution");
  assert.equal(assessCpuModel(model, { ...device(), cpu: { wasm: true, simd: true, threads: 4 } }).status, "suitable");
  assert.throws(() => requireCpuResources(model, { ...device(), ramEstimateGB: null }), /cpu_resources_ram-unknown/);
  assert.throws(() => requireCpuResources(cpuModels[1], device(), { ramGB: 4 }), /cpu_resources_ram-budget/);
  assert.throws(() => requireCpuResources(model, { ...device(), workerAvailable: false }), /cpu_resources_worker/);
  assert.throws(() => requireCpuResources(model, { ...device(), cpu: { wasm: true, simd: false, threads: 1 } }), /cpu_resources_simd/);
  assert.throws(() => requireCpuResources(model, { ...device(), cpu: undefined }), /cpu_resources_wasm/);
  assert.equal(assessCpuModel(model, { ...device(), ramEstimateGB: null }, { ramGB: 8, gpuGB: .25 }).blockers.length, 0);
  for (const cpuName of ["Intel Core", "AMD Ryzen", "Apple M", "ARM", "Unreported CPU"]) {
    assert.equal(requireCpuResources(model, { ...device(), cpuName }).blockers.length, 0);
  }
});

test("NVIDIA, AMD and Intel GPUs use identical feature and memory gates including private vendor labels", async () => {
  const gpuModel = getConversationModel("Qwen2.5-0.5B-Instruct-q4f32_1-MLC");
  const reports = [];
  for (const [label, expected] of [["NVIDIA", "nvidia"], ["0x10de", "nvidia"], ["AMD Radeon", "amd"], ["0x1002", "amd"], ["Intel Arc", "intel"], ["0x8086", "intel"], ["", "unknown"]]) {
    assert.equal(gpuVendor(label), expected);
    const measured = await inspectDevice({ hardwareConcurrency: 8, deviceMemory: 16, gpu: { requestAdapter: async () => ({ info: { vendor: label }, features: ["shader-f16"], limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 } }) } }, { workerAvailable: true });
    assert.equal(measured.gpuVendor, expected);
    reports.push(assessModel(gpuModel, measured, { ramGB: 16, gpuGB: 8 }));
  }
  for (const report of reports) assert.deepEqual(report, reports[0]);
  assert.equal(reports[0].status, "suitable");
});

test("CPU models preserve pinned publisher revisions, separate formats and valid saved selections", () => {
  for (const entry of cpuModels) {
    assert.ok(isConversationModel(entry.id)); assert.equal(getChatModel(entry.id).backend, "cpu");
    assert.match(entry.revision, /^[a-f0-9]{40}$/); assert.ok(entry.weightBytes > 100_000_000);
    assert.ok(cpuModelBaseUrl(entry).endsWith(`${entry.revision}/`));
    assert.equal(getConversationModel(entry.id), undefined);
  }
  assert.equal(getCpuModel("cpu:unknown"), undefined); assert.equal(isConversationModel("cpu:unknown"), false);
});

const memoryCache = () => {
  const entries = new Map();
  return { entries, async match(key) { return entries.get(typeof key === "string" ? key : key.url)?.clone(); }, async put(key, value) { entries.set(key, value.clone()); }, async delete(key) { return entries.delete(typeof key === "string" ? key : key.url); }, async keys() { return [...entries.keys()].map(url => new Request(url)); } };
};

test("CPU cache repairs truncated weights and malformed metadata without deleting other model files", async () => {
  const fixture = { ...model, weightBytes: 4 }, cache = memoryCache(), signal = new AbortController().signal;
  const base = cpuModelBaseUrl(fixture), weights = `${base}onnx/model_quantized.onnx`;
  const other = `${cpuModelBaseUrl(cpuModels[1])}onnx/model_quantized.onnx`;
  await cache.put(weights, new Response("bad")); await cache.put(other, new Response("keep"));
  const checked = verifiedCpuCache(fixture, cache, signal);
  assert.equal(await checked.match(weights), undefined); assert.equal(cache.entries.has(weights), false);
  await checked.put(weights, new Response("good"));
  assert.equal(await (await checked.match(weights)).text(), "good");
  await cache.put(`${base}config.json`, new Response('{"model_type":"wrong"}'));
  assert.equal(await checked.match(`${base}config.json`), undefined);
  await checked.put(`${base}config.json`, new Response('{"model_type":"qwen2","max_position_embeddings":32768}'));
  await checked.put(`${base}tokenizer.json`, new Response('{"model":{"vocab":{"hello":1}}}'));
  await checked.put(`${base}tokenizer_config.json`, new Response('{"chat_template":"template"}'));
  assert.equal((await checked.summary(true)).cacheComplete, true);
  await assert.rejects(checked.put(`${base}../other`, new Response("no")), /cpu_download_source/);
  assert.equal(await checked.match("https://unrelated.invalid/config.json"), undefined);
  const storage = { async keys() { return [cpuCacheName, "webllm/model"]; }, async open(name) { assert.equal(name, cpuCacheName); return cache; } };
  await clearCpuCache(fixture, storage);
  assert.deepEqual([...cache.entries.keys()], [other]);
});

test("CPU file audits reject excess bytes and malformed JSON with bounded reads", async () => {
  const fixture = { ...model, weightBytes: 4 }, signal = new AbortController().signal;
  await assert.rejects(validateCpuFile(fixture, "onnx/model_quantized.onnx", new Response("too long"), signal), /download_size/);
  await assert.rejects(validateCpuFile(fixture, "tokenizer_config.json", new Response("{}"), signal), /cpu_download_metadata/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(validateCpuFile(fixture, "config.json", new Response("{}"), controller.signal), error => error.name === "AbortError");
});

function bridge(loader) {
  let terminated = 0;
  const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage(command) { queueMicrotask(() => { if (!terminated) void handler(command); }); }, terminate() { terminated++; } };
  const handler = createCpuWorkerHandler(loader, data => { if (!terminated) worker.onmessage?.({ data }); });
  return { worker, get terminated() { return terminated; } };
}
const download = { weightBytes: model.weightBytes, shardCount: 1, cachedShards: 1, cacheComplete: true, responseTested: true };

test("the CPU worker protocol streams bilingual prompts, measured tokens and finish reasons into the chat session", async () => {
  let received, requestedThreads, calls = 0;
  const wire = bridge(async (selected, threads, progress) => {
    assert.equal(selected.id, model.id); requestedThreads = threads; progress({ progress: .9, text: "Testing CPU" });
    return { download, pipeline: { dispose() {}, async generate(messages, text) { received = messages; calls++; text("Hallo "); text("Alen."); return { text: "Hallo Alen.", completionTokens: 4, promptTokens: 120, finishReason: "length" }; } } };
  });
  const client = new CpuWorkerClient(wire.worker, () => assert.fail("unexpected worker failure"));
  const session = new ConversationSession({ load: async (id, options) => ({ modelId: id, cancelRequiresReload: true, adapter: client.adapter, dispose: () => client.dispose(), download: await client.load(id, 4, options.onProgress) }) });
  await session.load(model.id); assert.equal(requestedThreads, 4); assert.equal(session.ready, true);
  const partial = [], response = await session.generate({ text: "Erkläre MFA", locale: "de", preferences: { style: "concise", instructions: "Use examples." }, onText: text => partial.push(text) });
  assert.equal(response.text, "Hallo Alen."); assert.equal(response.finishReason, "length");
  assert.equal(response.metrics.completionTokens, 4); assert.equal(response.metrics.promptTokens, 120);
  assert.equal(partial.at(-1), response.text); assert.match(received[0].content, /German/); assert.match(received[0].content, /Use examples/);
  await session.generate({ text: "Explain again", locale: "en" }); assert.equal(calls, 2);
  session.unload(); assert.equal(wire.terminated, 1);
});

test("stopping CPU inference terminates the worker and clears readiness instead of keeping a dead runtime", async () => {
  const gate = deferred(); let entered = false;
  const wire = bridge(async () => ({ download, pipeline: { dispose() {}, async generate(messages, text) { entered = true; text("Partial"); await gate.promise; text("Late text"); return { text: "PartialLate text", completionTokens: 2, promptTokens: 1, finishReason: "stop" }; } } }));
  const client = new CpuWorkerClient(wire.worker, () => {});
  const session = new ConversationSession({ load: async id => ({ modelId: id, cancelRequiresReload: true, adapter: client.adapter, dispose: () => client.dispose(), download: await client.load(id, 1, () => {}) }) });
  await session.load(model.id);
  const controller = new AbortController(), seen = [];
  const request = session.generate({ text: "Hello", locale: "en", signal: controller.signal, onText: text => seen.push(text) });
  await tick(); assert.equal(entered, true); assert.equal(seen.at(-1), "Partial");
  controller.abort(); await assert.rejects(request, error => error.name === "AbortError");
  assert.equal(wire.terminated, 1); assert.equal(session.ready, false); assert.equal(session.getSnapshot().status, "idle");
  gate.resolve(); await tick(); assert.deepEqual(seen, ["Partial"]);
  await assert.rejects(session.generate({ text: "Next", locale: "en" }), /model_not_ready/);
});

test("terminal context and empty-output failures cannot leave a terminated CPU worker marked ready", async () => {
  for (const failure of ["context window exceeded", "empty"]) {
    const wire = bridge(async () => ({ download, pipeline: { dispose() {}, async generate() {
      if (failure !== "empty") throw Error(failure);
      return { text: "", completionTokens: 1, promptTokens: 1, finishReason: "stop" };
    } } }));
    const client = new CpuWorkerClient(wire.worker, () => {});
    const session = new ConversationSession({ load: async id => ({ modelId: id, cancelRequiresReload: true, adapter: client.adapter, dispose: () => client.dispose(), download: await client.load(id, 1, () => {}) }) });
    await session.load(model.id);
    await assert.rejects(session.generate({ text: "A question", locale: "en" }), /context|empty_generation/);
    assert.equal(wire.terminated, 1); assert.equal(session.ready, false); assert.equal(session.getSnapshot().status, "error");
    await assert.rejects(session.generate({ text: "Another question", locale: "en" }), /model_not_ready/);
  }
});

test("CPU workers reject unknown models before loading and worker failures reject pending initialization", async () => {
  let loads = 0; const wire = bridge(async () => { loads++; throw Error("unexpected load"); });
  const client = new CpuWorkerClient(wire.worker, () => {});
  await assert.rejects(client.load("cpu:unknown", 4, () => {}), /unsupported_model/); assert.equal(loads, 0); client.dispose();
  const worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} }; let fatals = 0;
  const broken = new CpuWorkerClient(worker, () => fatals++);
  const pending = broken.load(model.id, 1, () => {}); worker.onerror({});
  await assert.rejects(pending, /model_worker_failed/); assert.equal(fatals, 1);
});

test("CPU recovery errors are actionable in English and German without claiming a GPU is required", () => {
  for (const locale of ["en", "de"]) {
    for (const code of ["cpu_resources_simd", "cpu_resources_wasm", "cpu_resources_worker", "cpu_resources_ram-budget", "cpu_resources_ram-unknown", "cpu_memory", "cpu_download_size", "cpu_inference_failed"]) assert.match(conversationError(code, locale), /CPU|RAM|WebAssembly/);
    assert.match(conversationError("model_resources_webgpu", locale), /CPU/);
    assert.doesNotMatch(conversationError("WebAssembly.instantiate failed in the GPU engine", locale), /CPU runtime|CPU-Runtime/);
  }
});
