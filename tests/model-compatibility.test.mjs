// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { verifyChatCompatibility, requireTestedDownload } from "../lib/model-readiness.ts";
import { cpuModels } from "../lib/cpu-models.ts";
import { CpuWorkerClient } from "../lib/cpu-worker-client.ts";
import { createCpuWorkerHandler } from "../lib/cpu-worker-protocol.ts";
import { validateCpuFile } from "../lib/cpu-cache.ts";

const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
const model = cpuModels[0];
const good = { weightBytes: model.weightBytes, shardCount: 1, cachedShards: 0, cacheComplete: false, responseTested: true };

test("readiness tests system, English input, German follow-up, history and actual streaming before reset", async () => {
  const calls = [], events = [];
  await verifyChatCompatibility({ async generate(messages, onText) { calls.push(structuredClone(messages)); onText("Hello"); events.push("stream"); return "Hello"; }, async reset() { events.push("reset"); }, interrupt() { assert.fail("Unexpected interrupt"); } }, signal());
  assert.deepEqual(calls.map(messages => messages.map(message => message.role)), [["system", "user"], ["system", "user", "assistant", "user"]]);
  assert.match(calls[0][1].content, /English/); assert.match(calls[1][3].content, /Deutsch/);
  assert.equal(calls[1][2].content, "Hello"); assert.deepEqual(events, ["stream", "stream", "reset"]);
});

test("a final response without streamed text, empty follow-up or failed reset cannot pass readiness", async () => {
  for (const failure of ["stream", "empty", "reset"]) {
    let calls = 0, resets = 0;
    const runtime = { async generate(_messages, onText) { calls++; if (failure !== "stream") onText("Hello"); return failure === "empty" && calls === 2 ? " " : "Hello"; }, async reset() { resets++; if (failure === "reset") throw Error("reset failed"); }, interrupt() {} };
    await assert.rejects(verifyChatCompatibility(runtime, signal()), new RegExp(failure === "reset" ? "reset failed" : `model_response_test_${failure}`));
    assert.equal(resets, failure === "reset" ? 1 : 0);
  }
});

test("a timed-out probe that resolves late cannot start a follow-up or reset the model", { timeout: 1000 }, async () => {
  let finish, calls = 0, resets = 0, interrupts = 0;
  const runtime = { generate: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, async reset() { resets++; }, interrupt() { interrupts++; } };
  await assert.rejects(verifyChatCompatibility(runtime, signal(), 10), /model_response_test_timeout/);
  finish("Late answer"); await tick(); await tick();
  assert.equal(calls, 1); assert.equal(resets, 0); assert.equal(interrupts, 1);
});

test("user cancellation during a streamed follow-up never reports readiness", async () => {
  const controller = new AbortController(); let calls = 0, resets = 0;
  await assert.rejects(verifyChatCompatibility({ async generate(_messages, onText) { calls++; onText("Hello"); if (calls === 2) controller.abort(); return "Hello"; }, async reset() { resets++; }, interrupt() {} }, controller.signal), error => error.name === "AbortError");
  assert.equal(calls, 2); assert.equal(resets, 0);
});

test("CPU readiness rejects wrong sizes, untested workers and inconsistent cache counters, while in-memory loads remain valid", async () => {
  requireTestedDownload(good, model.weightBytes, 1);
  const invalid = [{ ...good, responseTested: false }, { ...good, weightBytes: 1 }, { ...good, shardCount: 2 }, { ...good, cachedShards: -1 }, { ...good, cachedShards: 2 }, { ...good, cacheComplete: true }, { ...good, cachedShards: NaN }, {}];
  for (const download of invalid) {
    assert.throws(() => requireTestedDownload(download, model.weightBytes, 1), /model_response_test_metadata/);
    let disposed = 0; const events = [];
    const handle = createCpuWorkerHandler(async () => ({ download, pipeline: { dispose() { disposed++; }, async generate() { assert.fail("Invalid model used"); } } }), reply => events.push(reply));
    await handle({ type: "load", id: 1, modelId: model.id, threads: 1 });
    assert.equal(disposed, 1); assert.equal(events.some(event => event.type === "ready"), false); assert.equal(events.at(-1).error, "model_response_test_metadata");
    await handle({ type: "generate", id: 2, messages: [{ role: "user", content: "Hi" }] }); assert.equal(events.at(-1).error, "model_not_ready");
    let terminated = 0;
    const worker = { onmessage: null, onerror: null, onmessageerror: null, terminate() { terminated++; }, postMessage(command) { this.onmessage({ data: { type: "ready", id: command.id, modelId: model.id, download } }); } };
    const client = new CpuWorkerClient(worker, () => {});
    await assert.rejects(client.load(model.id, 1, () => {}), /model_response_test_metadata/); assert.equal(terminated, 1);
    await assert.rejects(client.adapter.stream([{ role: "user", content: "Hi" }]), /model_not_ready/);
  }
});

test("a failed CPU reload cannot keep the previous worker state ready", async () => {
  let loads = 0;
  const worker = { onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(command) {
    if (command.type === "load") this.onmessage({ data: ++loads === 1 ? { type: "ready", id: command.id, modelId: model.id, download: good } : { type: "error", id: command.id, error: "cpu_download_missing" } });
  } };
  const client = new CpuWorkerClient(worker, () => {});
  await client.load(model.id, 1, () => {}); await assert.rejects(client.load(model.id, 1, () => {}), /cpu_download_missing/);
  await assert.rejects(client.adapter.stream([{ role: "user", content: "Hi" }]), /model_not_ready/); client.dispose();
});

test("CPU metadata refuses empty vocabulary, empty templates and invalid UTF-8", async () => {
  for (const [file, value] of [["tokenizer.json", '{"model":{"vocab":{}}}'], ["tokenizer_config.json", '{"chat_template":"   "}'], ["tokenizer_config.json", new Uint8Array([...new TextEncoder().encode('{"chat_template":"'), 255, ...new TextEncoder().encode('"}')])]]) await assert.rejects(validateCpuFile(model, file, new Response(value), signal()), /cpu_download_metadata/);
});

// Execute the actual CPU integration with only its SDK/cache boundaries replaced.
// No browser, GPU, network or pretrained weights are simulated as tested hardware.
const dataModule = code => `data:text/javascript;base64,${Buffer.from("// Copyright © 2026 Alen Pepa\n" + code).toString("base64")}`;
let cpuFixtureId = 0;
async function cpuPipelineFixture(state) {
  const key = `__aelvorCpuCompatibilityFixture${++cpuFixtureId}`; globalThis[key] = state;
  const ref = `globalThis[${JSON.stringify(key)}]`;
  const sdk = dataModule(`const s=${ref}; export const env={backends:{onnx:{wasm:{}}}}; export class TextStreamer{constructor(_tokenizer,options){this.callback=options.callback_function;}} export async function pipeline(task,repo,options){s.options={task,repo,...options};return {tokenizer:{apply_chat_template(messages){s.messages.push(structuredClone(messages));return {input_ids:{dims:[1,10]},attention_mask:{}};},decode(){return "Hello";}},model:{async generate(options){if(s.failAt===s.messages.length)throw Error("incompatible history template");options.streamer.callback("Hello");return {tolist:()=>[Array(10).fill(0).concat([1,151645])]};}},async dispose(){s.disposed++;}};}`);
  const file = new URL("../lib/cpu-pipeline.ts", import.meta.url), source = await readFile(file, "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  for (const match of [...outputText.matchAll(/from (["'])([^"']+)\1/g)]) outputText = outputText.replace(match[0], `from ${JSON.stringify(match[2] === "@huggingface/transformers" ? sdk : new URL(match[2], file).href)}`);
  const previous = { self: globalThis.self, caches: globalThis.caches };
  globalThis.self = { location: { origin: "https://app.example" } };
  globalThis.caches = { async open() { return { async match() { return undefined; }, async put() {}, async delete() {} }; } };
  return { ...(await import(dataModule(outputText))), cleanup() { globalThis.self = previous.self; globalThis.caches = previous.caches; delete globalThis[key]; } };
}

test("each pinned CPU model uses q8 WASM and passes two real integration probe calls before readiness", async () => {
  for (const model of cpuModels) {
    const state = { messages: [], disposed: 0 }, fixture = await cpuPipelineFixture(state);
    try {
      const runtime = await fixture.createCpuPipeline(model, 1, () => {}, { contextWindow: 2048, outputTokens: 128 });
      assert.equal(state.options.repo, model.repo); assert.equal(state.options.revision, model.revision); assert.equal(state.options.dtype, "q8"); assert.equal(state.options.device, "wasm");
      assert.equal(state.messages.length, 2); assert.deepEqual(state.messages[1].map(message => message.role), ["system", "user", "assistant", "user"]);
      assert.equal(runtime.download.responseTested, true); assert.equal(runtime.download.cacheComplete, false); requireTestedDownload(runtime.download, model.weightBytes, 1);
      runtime.pipeline.dispose(); assert.equal(state.disposed, 1);
    } finally { fixture.cleanup(); }
  }
});

test("an incompatible CPU history template fails the actual integration and disposes the loaded generator", async () => {
  const state = { messages: [], disposed: 0, failAt: 2 }, fixture = await cpuPipelineFixture(state);
  try { await assert.rejects(fixture.createCpuPipeline(model, 1, () => {}), /incompatible history template/); assert.equal(state.messages.length, 2); assert.equal(state.disposed, 1); }
  finally { fixture.cleanup(); }
});
