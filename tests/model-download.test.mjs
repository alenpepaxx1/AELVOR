// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { catalogVersion, modelCatalog } from "../lib/model-catalog.ts";
import { clearModelCache, inspectModelCache, modelBaseUrl, modelCacheScopes, prepareModelDownload, responseBytes } from "../lib/model-download.ts";
import { chatProfile, monotonicProgress, verifyModelResponse } from "../lib/model-readiness.ts";

class MemoryCache {
  entries = new Map();
  async match(key) { const item = this.entries.get(typeof key === "string" ? key : key.url); return item && new Response(item.bytes.slice(), { status: item.status, headers: item.headers }); }
  async put(key, response) { this.entries.set(typeof key === "string" ? key : key.url, { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status, headers: [...response.headers] }); }
  async delete(key) { return this.entries.delete(typeof key === "string" ? key : key.url); }
  async keys() { return [...this.entries.keys()].map(key => new Request(key)); }
}
class MemoryStorage {
  stores = new Map();
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new MemoryCache()); return this.stores.get(name); }
  async keys() { return [...this.stores.keys()]; }
}
const record = { model_id: "fixture", model: "https://huggingface.co/mlc-ai/fixture", model_lib: "https://example.org/v0_2_86/base/shared.wasm" };
const signal = () => new AbortController().signal;
const json = value => new Response(JSON.stringify(value));
const chatConfig = (extra = {}) => ({ tokenizer_files: ["tokenizer.json", "tokenizer.model"], vocab_size: 100, conv_template: { system_template: "{system_message}", roles: { user: "user", assistant: "assistant" }, seps: ["\n"], role_content_sep: ": ", role_empty_sep: ":" }, ...extra });
const manifest = () => ({ records: [
  { dataPath: "params_shard_0.bin", nbytes: 3, records: [{ byteOffset: 0, nbytes: 3 }] },
  { dataPath: "params_shard_1.bin", nbytes: 4, records: [{ byteOffset: 0, nbytes: 4 }] },
] });
function fixture() {
  const base = modelBaseUrl(record), calls = [], storage = new MemoryStorage();
  const files = new Map([[`${base}mlc-chat-config.json`, chatConfig()], [`${base}tensor-cache.json`, manifest()]]);
  const env = { caches: storage, fetch: async url => { calls.push(url); return files.has(url) ? json(files.get(url)) : new Response(null, { status: 404 }); } };
  return { base, calls, storage, files, env };
}
async function fill(plan, storage) {
  const weights = await storage.open(modelCacheScopes.model);
  for (const shard of plan.shards) await weights.put(shard.url, new Response(new Uint8Array(shard.bytes)));
  await weights.put(plan.tokenizerUrl, json({}));
  await (await storage.open(modelCacheScopes.wasm)).put(plan.wasmUrl, new Response(new Uint8Array([0, 97, 115, 109])));
}

test("all catalog downloads use their installed SDK source and versioned runtime, including shared libraries", () => {
  const libraries = new Set();
  for (const model of modelCatalog) {
    const installed = prebuiltAppConfig.model_list.find(item => item.model_id === model.id);
    assert.equal(installed.model, model.sourceUrl);
    assert.equal(modelBaseUrl(installed), `${model.sourceUrl}/resolve/main/`);
    assert.match(installed.model_lib, new RegExp(`/v${catalogVersion.replaceAll(".", "_")}/`));
    assert.match(installed.model_lib, /\.wasm$/);
    libraries.add(installed.model_lib);
  }
  assert.ok(libraries.size < modelCatalog.length, "shared compiled libraries are legitimate");
  assert.equal(modelBaseUrl({ model: "https://example.org/model/resolve/revision/" }), "https://example.org/model/resolve/revision/");
  assert.throws(() => modelBaseUrl({ model: "http://example.org/model" }), /model_download_source/);
});

test("preflight downloads metadata only, uses SDK tokenizer preference and reuses valid cached metadata", async () => {
  const f = fixture(), plan = await prepareModelDownload(record, signal(), f.env);
  assert.equal(plan.weightBytes, 7); assert.equal(plan.shards.length, 2);
  assert.equal(plan.tokenizerUrl, `${f.base}tokenizer.json`);
  assert.deepEqual(f.calls, [`${f.base}mlc-chat-config.json`, `${f.base}tensor-cache.json`]);
  await prepareModelDownload(record, signal(), f.env); assert.equal(f.calls.length, 2);
});

test("incompatible chat templates and vocabularies fail before manifests or weight loading; SDK overrides remain supported", async () => {
  for (const mutate of [config => delete config.vocab_size, config => config.vocab_size = -1, config => config.conv_template = "legacy-name", config => delete config.conv_template.roles.assistant, config => config.conv_template.seps = [], config => config.conv_template.role_empty_sep = null, config => config.conv_config = []]) {
    const f = fixture(), config = chatConfig(); mutate(config); f.files.set(`${f.base}mlc-chat-config.json`, config);
    await assert.rejects(prepareModelDownload(record, signal(), f.env), /model_download_chat_config/);
    assert.deepEqual(f.calls, [`${f.base}mlc-chat-config.json`]);
    assert.equal(await (await f.storage.open(modelCacheScopes.config)).match(`${f.base}mlc-chat-config.json`), undefined);
  }
  const f = fixture(); f.files.set(`${f.base}mlc-chat-config.json`, chatConfig({ vocab_size: -1, conv_config: { role_empty_sep: "override" } }));
  await prepareModelDownload({ ...record, overrides: { vocab_size: 100 } }, signal(), f.env);
  assert.equal(f.calls.length, 2);
});

test("corrupt JSON and invalid cached schemas are evicted and fetched once without discarding good files", async () => {
  const f = fixture(), config = await f.storage.open(modelCacheScopes.config), weights = await f.storage.open(modelCacheScopes.model);
  await config.put(`${f.base}mlc-chat-config.json`, new Response("broken{"));
  await weights.put(`${f.base}tensor-cache.json`, json({ records: [] }));
  await weights.put(`${f.base}params_shard_0.bin`, new Response("abc"));
  const plan = await prepareModelDownload(record, signal(), f.env);
  assert.equal(f.calls.length, 2);
  assert.equal(await (await weights.match(plan.shards[0].url)).text(), "abc");
});

test("package manifests and tokenizer.model fallback follow the runtime contract", async () => {
  const f = fixture(), packageRecord = { ...record, model_manifest: "mlc-model-manifest.json" };
  f.files.set(`${f.base}mlc-model-manifest.json`, { schema: "mlc.model-package", schema_version: 1, weights: { manifest: "tensor-cache.json" } });
  f.files.set(`${f.base}mlc-chat-config.json`, chatConfig({ tokenizer_files: ["tokenizer.model"] }));
  const plan = await prepareModelDownload(packageRecord, signal(), f.env);
  assert.equal(plan.packageUrl, `${f.base}mlc-model-manifest.json`);
  assert.equal(plan.tokenizerUrl, `${f.base}tokenizer.model`);
  const bad = fixture(); bad.files.set(`${bad.base}mlc-chat-config.json`, { tokenizer_files: ["vocab.json"] });
  await assert.rejects(prepareModelDownload(record, signal(), bad.env), /model_download_tokenizer/);
});

test("invalid tensor paths, duplicate parts, byte counts and out-of-bounds tensors cannot reach the loader", async () => {
  const invalid = [
    m => m.records[0].dataPath = "../other.bin",
    m => m.records[0].dataPath = "%2e%2e/other.bin",
    m => m.records[0].dataPath = "https://another.example/weights.bin",
    m => m.records[0].dataPath = "params\\other.bin",
    m => m.records[1].dataPath = m.records[0].dataPath,
    m => m.records[0].nbytes = -1,
    m => m.records[0].nbytes = 1.5,
    m => m.records[0].nbytes = Number.MAX_SAFE_INTEGER + 1,
    m => m.records[0].records[0].byteOffset = 1,
    m => m.records = [],
  ];
  for (const mutate of invalid) {
    const f = fixture(), data = manifest(); mutate(data); f.files.set(`${f.base}tensor-cache.json`, data);
    await assert.rejects(prepareModelDownload(record, signal(), f.env), /model_download_metadata/);
    assert.equal(await (await f.storage.open(modelCacheScopes.model)).match(`${f.base}tensor-cache.json`), undefined);
  }
});

test("truncated cached parts are removed for redownload, while complete parts and unrelated models survive", async () => {
  const f = fixture(), plan = await prepareModelDownload(record, signal(), f.env), weights = await f.storage.open(modelCacheScopes.model);
  await fill(plan, f.storage);
  await weights.put(plan.shards[0].url, new Response("ab"));
  await weights.put("https://example.org/other/weights.bin", new Response("keep"));
  let info = await inspectModelCache(plan, signal(), { repair: true }, f.env);
  assert.equal(info.cachedShards, 1); assert.equal(info.cacheComplete, false);
  assert.equal(await weights.match(plan.shards[0].url), undefined);
  assert.equal(await (await weights.match(plan.shards[1].url)).arrayBuffer().then(x => x.byteLength), 4);
  assert.equal(await (await weights.match("https://example.org/other/weights.bin")).text(), "keep");
  await weights.put(plan.shards[0].url, new Response("abc"));
  info = await inspectModelCache(plan, signal(), { repair: false }, f.env);
  assert.equal(info.cacheComplete, true); assert.equal(info.responseTested, false);
  await weights.put(plan.shards[0].url, new Response("oversize"));
  await assert.rejects(inspectModelCache(plan, signal(), { repair: false }, f.env), /model_download_size/);
  assert.equal(await weights.match(plan.shards[0].url), undefined);
});

test("a missing tokenizer or runtime is reported as incomplete cache even with all weights", async () => {
  const f = fixture(), plan = await prepareModelDownload(record, signal(), f.env);
  await fill(plan, f.storage);
  await (await f.storage.open(modelCacheScopes.wasm)).delete(plan.wasmUrl);
  const info = await inspectModelCache(plan, signal(), { repair: false }, f.env);
  assert.equal(info.cachedShards, 2); assert.equal(info.cacheComplete, false);
});

test("offline cache removal needs no manifest or fetch and preserves other model prefixes and app caches", async () => {
  const f = fixture(), model = await f.storage.open(modelCacheScopes.model), config = await f.storage.open(modelCacheScopes.config), wasm = await f.storage.open(modelCacheScopes.wasm);
  for (const path of ["tensor-cache.json", "params_shard_0.bin", "tokenizer.json", "unknown-part.bin"]) await model.put(`${f.base}${path}`, new Response("corrupt"));
  await config.put(`${f.base}mlc-chat-config.json`, new Response("corrupt"));
  await wasm.put(record.model_lib, new Response("compiled"));
  const other = "https://huggingface.co/mlc-ai/fixture-other/resolve/main/params.bin";
  await model.put(other, new Response("keep"));
  await wasm.put("https://example.org/other.wasm", new Response("keep"));
  await (await f.storage.open("app-chat-cache")).put("https://app.example/history", new Response("keep"));
  await clearModelCache(record, f.storage); await clearModelCache(record, f.storage);
  assert.deepEqual(f.calls, []);
  assert.deepEqual((await model.keys()).map(x => x.url), [other]);
  assert.equal((await config.keys()).length, 0);
  assert.deepEqual((await wasm.keys()).map(x => x.url), ["https://example.org/other.wasm"]);
  assert.equal((await (await f.storage.open("app-chat-cache")).keys()).length, 1);
  const empty = new MemoryStorage(); await clearModelCache(record, empty); assert.deepEqual(await empty.keys(), []);
});

test("metadata retry distinguishes temporary errors from missing and denied files", async () => {
  for (const status of [401, 403, 404]) {
    const f = fixture(); f.env.fetch = async () => { f.calls.push(status); return new Response(null, { status }); };
    await assert.rejects(prepareModelDownload(record, signal(), f.env), new RegExp(`http_${status}`));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(), fetch = f.env.fetch; let attempts = 0;
  f.env.fetch = async url => ++attempts === 1 ? new Response(null, { status: 503 }) : fetch(url);
  await prepareModelDownload(record, signal(), f.env); assert.equal(attempts, 3);
});

test("metadata deadlines are bounded and user cancellation never retries", async () => {
  const f = fixture(); let attempts = 0;
  f.env.timeoutMs = 5;
  f.env.fetch = (_url, { signal }) => { attempts++; return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); };
  await assert.rejects(prepareModelDownload(record, signal(), f.env), /model_download_timeout/); assert.equal(attempts, 2);
  const controller = new AbortController(); attempts = 0;
  const task = prepareModelDownload(record, controller.signal, f.env);
  setTimeout(() => controller.abort(), 1);
  await assert.rejects(task, error => error.name === "AbortError"); assert.equal(attempts, 1);
  attempts = 0; await assert.rejects(prepareModelDownload(record, controller.signal, f.env), error => error.name === "AbortError"); assert.equal(attempts, 0);
});

test("a metadata fetch that ignores AbortSignal still times out and never holds model loading open", { timeout: 500 }, async () => {
  const f = fixture(); let attempts = 0;
  f.env.timeoutMs = 5; f.env.fetch = () => { attempts++; return new Promise(() => {}); };
  await assert.rejects(prepareModelDownload(record, signal(), f.env), /model_download_timeout/);
  assert.equal(attempts, 2);
});

test("a stalled metadata cache write is covered by the same bounded deadline", { timeout: 500 }, async () => {
  const f = fixture(), cache = await f.storage.open(modelCacheScopes.config); let writes = 0;
  f.env.timeoutMs = 5; cache.put = () => { writes++; return new Promise(() => {}); };
  await assert.rejects(prepareModelDownload(record, signal(), f.env), /model_download_timeout/);
  assert.equal(writes, 2);
});

test("user cancellation discards a late metadata fetch and never writes it to model cache", async () => {
  const f = fixture(), controller = new AbortController(); let finish, cancelled = false;
  f.env.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = prepareModelDownload(record, controller.signal, f.env);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await assert.rejects(pending, error => error.name === "AbortError");
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal((await (await f.storage.open(modelCacheScopes.config)).keys()).length, 0);
});

test("byte verification streams without arrayBuffer and respects bounds and cancellation", async () => {
  const response = new Response("abcdef"); response.arrayBuffer = () => { throw Error("must stream"); };
  assert.equal((await responseBytes(response, signal(), 6)).bytes, 6);
  await assert.rejects(responseBytes(new Response("abcdefg"), signal(), 6), /model_download_size/);
  const controller = new AbortController(); let cancelled = false;
  const hanging = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const task = responseBytes(hanging, controller.signal, 10); controller.abort();
  await assert.rejects(task, error => error.name === "AbortError"); assert.equal(cancelled, true);
});

test("loading progress never regresses or claims completion before readiness", () => {
  const seen = [], progress = monotonicProgress(value => seen.push(value.progress));
  for (const value of [0.1, 0.7, 0, NaN, 1, 0.9]) progress(value, "phase");
  assert.deepEqual(seen, [0.1, 0.7, 0.7, 0.7, 0.99, 0.99]);
});

test("readiness requires nonempty local output and resets the synthetic exchange", async () => {
  const events = [];
  await verifyModelResponse({ reply: async () => { events.push("reply"); return "OK"; }, reset: async () => { events.push("reset"); }, interrupt() {} }, signal());
  assert.deepEqual(events, ["reply", "reset"]);
  let reset = 0;
  await assert.rejects(verifyModelResponse({ reply: async () => " ", reset: async () => { reset++; }, interrupt() {} }, signal()), /model_response_test_empty/);
  assert.equal(reset, 1);
  await assert.rejects(verifyModelResponse({ reply: async () => { throw Error("GPU failed"); }, reset: async () => {}, interrupt() {} }, signal()), /GPU failed/);
});

test("the local response test interrupts stalled/cancelled work and never resets during a pending decode", async () => {
  let interrupts = 0, resets = 0;
  const runtime = { reply: () => new Promise(() => {}), reset: async () => { resets++; }, interrupt() { interrupts++; } };
  await assert.rejects(verifyModelResponse(runtime, signal(), 5), /model_response_test_timeout/);
  assert.equal(interrupts, 1); assert.equal(resets, 0);
  const controller = new AbortController(), task = verifyModelResponse(runtime, controller.signal); controller.abort();
  await assert.rejects(task, error => error.name === "AbortError"); assert.equal(interrupts, 2);
});

test("generation uses bounded contexts and disables thinking only for SDK-supported Qwen3 profiles", () => {
  assert.equal(chatProfile("Qwen3-0.6B-q4f32_1-MLC", 4096).extra_body.enable_thinking, false);
  assert.equal(chatProfile("Qwen3.5-0.8B-q4f16_1-MLC", 4096).extra_body, undefined);
  assert.equal(chatProfile("TinyLlama", 1024).max_tokens, 512);
  assert.equal(chatProfile("Qwen2.5", 4096).max_tokens, 768);
});
