// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { prebuiltAppConfig, ModelType } from "@mlc-ai/web-llm";
import { catalogVersion, modelCatalog, getConversationModel } from "../lib/model-catalog.ts";
import { defaultConversationModel, isConversationModel } from "../lib/conversation.ts";
import { assessModel, inspectDevice, normalizeDeviceBudget, requireModelResources, runtimeGpuRequirements, runtimeBufferLimits } from "../lib/device-capabilities.ts";
import { withModelResources } from "../lib/model-load-gate.ts";
import { conversationError } from "../lib/conversation-errors.ts";

const small = getConversationModel("Qwen2.5-0.5B-Instruct-q4f32_1-MLC");
const larger = getConversationModel("Llama-3.2-3B-Instruct-q4f32_1-MLC");
const device = (patch = {}) => ({ checkedAt: Date.now(), cpuThreads: 8, ramEstimateGB: 8, gpu: "available", gpuName: "Test adapter", features: ["shader-f16"], maxBufferBytes: 1024 ** 3, maxStorageBufferBytes: 256 * 1024 ** 2, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 20, workerAvailable: true, ...patch });

test("the full catalog matches text models in the installed SDK, including model-specific context limits", () => {
  assert.equal(catalogVersion, runtimeGpuRequirements.sdkVersion, "Review runtime limits when upgrading the SDK");
  const records = prebuiltAppConfig.model_list.filter(item => (item.model_type ?? ModelType.LLM) === ModelType.LLM);
  assert.ok(modelCatalog.length > 3);
  assert.equal(new Set(modelCatalog.map(item => item.id)).size, records.length);
  assert.equal(modelCatalog.length, records.length);
  for (const record of records) {
    const item = getConversationModel(record.model_id);
    assert.ok(item);
    assert.equal(isConversationModel(record.model_id), true);
    assert.equal(item.memoryGB, record.vram_required_MB / 1000);
    assert.equal(item.contextWindow, Math.min(4096, record.overrides.context_window_size));
    assert.equal(item.sourceUrl, record.model);
    for (const feature of record.required_features ?? []) assert.ok(item.requiredFeatures.includes(feature));
    if (/q\d+f16/.test(record.model_id)) assert.ok(item.requiredFeatures.includes("shader-f16"));
  }
  for (const record of prebuiltAppConfig.model_list.filter(item => item.model_type && item.model_type !== ModelType.LLM)) assert.equal(isConversationModel(record.model_id), false);
  assert.equal(isConversationModel("made-up-model"), false);
  assert.equal(isConversationModel(defaultConversationModel), true);
  assert.ok(modelCatalog.some(item => item.contextWindow === 1024));
  assert.equal(getConversationModel("constructor"), undefined);
});

test("FP16 is rejected without GPU support even when an upstream record omits its feature flag", () => {
  const fp16 = getConversationModel("Llama-3.2-1B-Instruct-q4f16_1-MLC");
  assert.ok(assessModel(fp16, device({ features: [] })).blockers.includes("features"));
  assert.throws(() => requireModelResources(fp16, device({ features: [] })), /model_resources_features/);
  assert.ok(!assessModel(small, device({ features: [] })).blockers.includes("features"));
});

test("GPU buffer limits are checked as allocation constraints and never inferred as VRAM capacity", () => {
  const model = { ...small, bufferBytes: 512 * 1024 ** 2 };
  assert.ok(assessModel(model, device()).blockers.includes("buffer"));
  assert.ok(assessModel(model, device({ maxBufferBytes: 256 * 1024 ** 2, maxStorageBufferBytes: 1024 ** 3 })).blockers.includes("buffer"));
  assert.ok(assessModel(model, device({ maxBufferBytes: null })).blockers.includes("probe"));
  assert.ok(!assessModel(small, device({ maxBufferBytes: 128 * 1024 ** 2 })).blockers.includes("gpu-budget"));
});

test("missing or underestimated memory data is gated conservatively, with a way to supply known budgets", () => {
  assert.equal(assessModel(small, device()).status, "caution");
  assert.ok(assessModel(larger, device()).blockers.includes("gpu-unknown"));
  assert.ok(assessModel(larger, device({ ramEstimateGB: 2 }), { gpuGB: 8 }).blockers.includes("ram-estimate"));
  assert.ok(assessModel(larger, device({ ramEstimateGB: null }), { gpuGB: 8 }).blockers.includes("ram-unknown"));
  const known = assessModel(larger, device({ ramEstimateGB: 2 }), { ramGB: 16, gpuGB: 8 });
  assert.equal(known.status, "suitable");
  assert.ok(known.gpuPlanningGB > larger.memoryGB);
  assert.equal(assessModel(larger, device(), { ramGB: 16, gpuGB: 2 }).blockers.includes("gpu-budget"), true);
  assert.equal(assessModel(larger, device(), { ramGB: 2, gpuGB: 8 }).blockers.includes("ram-budget"), true);
});

test("CPU count and storage quota remain independent advisory signals", () => {
  const report = assessModel(small, device({ cpuThreads: 2, cacheAvailableGB: 0.01 }), { ramGB: 8, gpuGB: 4 });
  assert.deepEqual(report.blockers, []);
  assert.ok(report.warnings.includes("cpu"));
  assert.ok(report.warnings.includes("storage"));
  assert.equal(report.status, "caution");
  assert.ok(assessModel(small, device({ cpuThreads: null }), { ramGB: 8, gpuGB: 4 }).warnings.includes("cpu"));
});

test("device inspection reads logical CPUs, coarse RAM, GPU features, buffer limits and cache quota separately", async () => {
  let requested;
  const result = await inspectDevice({ hardwareConcurrency: 12, deviceMemory: 8, gpu: { requestAdapter: async options => { requested = options; return { info: { vendor: "Example", architecture: "Test" }, features: new Set(["shader-f16"]), limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 } }; } }, storage: { estimate: async () => ({ quota: 5e9, usage: 2e9 }) } }, { workerAvailable: true });
  assert.deepEqual(requested, { powerPreference: "high-performance" });
  assert.equal(result.cpuThreads, 12);
  assert.equal(result.ramEstimateGB, 8);
  assert.equal(result.gpu, "available");
  assert.equal(result.gpuName, "Example Test");
  assert.deepEqual(result.features, ["shader-f16"]);
  assert.equal(result.maxStorageBufferBytes, 2 ** 28);
  assert.equal(result.cacheAvailableGB, 3);
  assert.ok(result.checkedAt <= Date.now());
});

test("unsupported, refused and stalled GPU probes cannot report a successful device check", async () => {
  assert.equal((await inspectDevice({}, { workerAvailable: true })).gpu, "unavailable");
  assert.equal((await inspectDevice({ gpu: { requestAdapter: async () => null } }, { workerAvailable: true })).gpu, "unavailable");
  const hidden = await inspectDevice({ gpu: { requestAdapter: async () => { throw Error("denied"); } } }, { workerAvailable: true });
  assert.equal(hidden.gpu, "unknown");
  assert.throws(() => requireModelResources(small, hidden), /model_resources_probe/);
  const stalled = await inspectDevice({ gpu: { requestAdapter: () => new Promise(() => {}) }, storage: { estimate: () => new Promise(() => {}) } }, { timeoutMs: 5, workerAvailable: true });
  assert.equal(stalled.gpu, "unknown");
  assert.equal(stalled.cacheAvailableGB, null);
  assert.throws(() => requireModelResources(small, device({ workerAvailable: false })), /model_resources_worker/);
});

test("persisted budgets accept only finite positive values in the supported range", () => {
  for (const value of [null, undefined, [], { ramGB: "32", gpuGB: -2 }, { ramGB: NaN, gpuGB: Infinity }, { ramGB: 0.5, gpuGB: 0.1 }, { ramGB: 2048, gpuGB: 1024 }]) assert.deepEqual(normalizeDeviceBudget(value), {});
  assert.deepEqual(normalizeDeviceBudget({ ramGB: 16, gpuGB: 8, unrelated: "ignored" }), { ramGB: 16, gpuGB: 8 });
});

test("the runtime gate rechecks every load and never starts downloads on a failed check", async () => {
  let probes = 0, downloads = 0;
  const options = { signal: new AbortController().signal, budget: { ramGB: 16, gpuGB: 8 }, inspect: async () => { probes++; return device({ gpu: probes === 1 ? "available" : "unavailable" }); } };
  const start = async () => { downloads++; return "loaded-runtime"; };
  assert.equal(await withModelResources(larger, options, start), "loaded-runtime");
  await assert.rejects(withModelResources(larger, options, start), /model_resources_webgpu/);
  assert.equal(probes, 2);
  assert.equal(downloads, 1);
});

test("cancelled checks never start a worker or download after the probe resolves", async () => {
  const controller = new AbortController(); let finish, started = false;
  const check = withModelResources(small, { signal: controller.signal, inspect: () => new Promise(resolve => { finish = resolve; }) }, async () => { started = true; });
  controller.abort();
  await assert.rejects(check, error => error.name === "AbortError");
  finish(device());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, false);
  await assert.rejects(withModelResources(small, { signal: controller.signal }, async () => { started = true; }), error => error.name === "AbortError");
});

test("resource failures preserve actionable English and German explanations", () => {
  assert.match(conversationError("model_resources_gpu-budget", "en"), /GPU memory budget/);
  assert.match(conversationError("model_resources_ram-estimate", "de"), /RAM-Schätzung/);
  assert.match(conversationError("model_resources_features", "en"), /FP32/);
  assert.match(conversationError("model_resources_buffer", "en"), /not total VRAM/);
  assert.match(conversationError("model_resources_webgpu", "de"), /WebGPU/);
});

test("an unavailable GPU label does not invalidate usable GPU capabilities", async () => {
  const adapter = { features: new Set(["shader-f16"]), limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 } };
  Object.defineProperty(adapter, "info", { get() { throw new Error("adapter information restricted"); } });
  const result = await inspectDevice({ hardwareConcurrency: 8, deviceMemory: 8, gpu: { requestAdapter: async () => adapter } }, { workerAvailable: true });
  assert.equal(result.gpu, "available");
  assert.deepEqual(result.features, ["shader-f16"]);
  assert.equal(result.maxStorageBufferBytes, 2 ** 28);
  assert.equal(result.gpuName, "");
});

test("privacy-restricted navigator getters remain unknown without rejecting the device inspection", async () => {
  const nav = {};
  for (const key of ["hardwareConcurrency", "deviceMemory", "gpu", "storage"]) Object.defineProperty(nav, key, { get() { throw new Error("restricted"); } });
  const result = await inspectDevice(nav, { workerAvailable: true });
  assert.equal(result.cpuThreads, null);
  assert.equal(result.ramEstimateGB, null);
  assert.equal(result.gpu, "unknown");
  assert.equal(result.cacheAvailableGB, null);
});

test("all models honor the installed runtime's minimum GPU limits before any download", () => {
  for (const patch of [{ maxBufferBytes: 128 * 1024 ** 2 }, { maxStorageBufferBytes: 64 * 1024 ** 2 }, { maxComputeWorkgroupStorageBytes: 16 * 1024 }, { maxStorageBuffersPerStage: 8 }]) {
    assert.ok(assessModel(small, device(patch), { ramGB: 16, gpuGB: 8 }).blockers.includes("runtime-limits"), JSON.stringify(patch));
    assert.throws(() => requireModelResources(small, device(patch), { ramGB: 16, gpuGB: 8 }), /model_resources_runtime-limits/);
  }
});

test("model buffers are compared with the limits the SDK actually requests", () => {
  const model = { ...small, bufferBytes: 200 * 1024 ** 2 };
  const adapter = device({ maxStorageBufferBytes: 512 * 1024 ** 2 });
  // This SDK requests a 128 MiB device limit when the adapter has less than 1 GiB.
  assert.ok(assessModel(model, adapter, { ramGB: 16, gpuGB: 8 }).blockers.includes("buffer"));
  assert.equal(runtimeBufferLimits(adapter).maxStorageBufferBytes, 128 * 1024 ** 2);
});
