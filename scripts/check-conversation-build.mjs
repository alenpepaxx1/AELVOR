// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";

function files(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]); }
const client = files("dist/client").filter(file => file.endsWith(".js"));
const assets = client.filter(file => /\/(?:conversation|cpu-conversation|model-training)\.worker-[\w-]+\.js$/.test(file));
assert.ok(assets.some(file => /\/conversation\.worker-/.test(file)), "Conversation worker asset missing");
assert.ok(assets.some(file => /\/cpu-conversation\.worker-/.test(file)), "CPU conversation worker asset missing");
assert.ok(assets.some(file => /model-training\.worker-/.test(file)), "Classifier worker asset missing");
const bundles = client.filter(file => !assets.includes(file)).map(file => readFileSync(file, "utf8"));
for (const worker of assets) {
  const filename = worker.split("/").at(-1);
  const references = bundles.filter(source => source.includes(filename));
  assert.ok(references.length, `${filename}: no client reference`);
  assert.ok(references.some(source => source.includes(`/_next/static/${filename}`)), `${filename}: expected same-origin asset path`);
}
for (const source of bundles) {
  for (const match of source.matchAll(/new Worker\((.{0,350})/g)) assert.ok(!match[1].includes("file:///"), "Invalid file URL in emitted worker constructor");
}

const builtWorker = assets.find(file => /\/conversation\.worker-/.test(file));
const thread = new Worker(new URL("./conversation-worker-smoke-host.mjs", import.meta.url), { workerData: { entry: pathToFileURL(resolve(builtWorker)).href } });
let timer;
try {
  const workerFailure = new Promise((_, reject) => thread.once("error", reject));
  const adapter = { onmessage: null, postMessage: data => thread.postMessage(data) };
  thread.on("message", data => adapter.onmessage?.(new MessageEvent("message", { data })));
  // An empty registry rejects before fetching model assets or requesting a GPU.
  const engine = new WebWorkerMLCEngine(adapter, { appConfig: { model_list: [] }, logLevel: "ERROR" });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("SDK worker protocol timeout")), 10000); });
  await assert.rejects(Promise.race([engine.reload("aegis-deliberately-unknown-model"), workerFailure, timeout]), /Cannot find.*model|model.*not found|not.*model.*appConfig/i);
  console.log("Production worker URLs and compiled WebLLM message protocol verified. GPU inference remains unverified.");
} finally { clearTimeout(timer); await thread.terminate(); }

const cpuWorker = assets.find(file => /\/cpu-conversation\.worker-/.test(file));
const cpuThread = new Worker(new URL("./conversation-worker-smoke-host.mjs", import.meta.url), { workerData: { entry: pathToFileURL(resolve(cpuWorker)).href, scriptLocation: "https://runtime.invalid/cpu-worker.js" } });
try {
  const response = new Promise((resolve, reject) => { cpuThread.once("message", resolve); cpuThread.once("error", reject); });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("CPU worker protocol timeout")), 10000); });
  cpuThread.postMessage({ type: "load", id: 1, modelId: "cpu:deliberately-unknown", threads: 1 });
  const result = await Promise.race([response, timeout]);
  assert.equal(result.type, "error"); assert.equal(result.id, 1); assert.equal(result.error, "unsupported_model");
  console.log("Production CPU worker message protocol verified before any model download.");
} finally { clearTimeout(timer); await cpuThread.terminate(); }
