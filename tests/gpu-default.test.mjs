// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { restoreRuntimePreference, selectedRuntimePreference, runtimeLabel } from "../lib/runtime-preference.ts";
import { createConversationLoader } from "../lib/conversation-loader.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { defaultCpuModel, assessCpuModel, cpuModels } from "../lib/cpu-models.ts";
import { defaultPhoneGpuModel } from "../lib/mobile-models.ts";
import { getChatModel } from "../lib/chat-models.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { inspectDevice, assessModel } from "../lib/device-capabilities.ts";
import { withModelResources } from "../lib/model-load-gate.ts";
import { conversationError } from "../lib/conversation-errors.ts";

test("computers and laptops default to GPU even with an old CPU setting that never recorded explicit intent", () => {
  for (const input of [null, {}, { modelId: defaultCpuModel }, { modelId: defaultCpuModel, cpuExplicitChoice: "true" }, { modelId: "unknown" }]) {
    assert.deepEqual(restoreRuntimePreference(input, false), { modelId: defaultConversationModel, cpuExplicitChoice: false });
  }
  const gpu = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
  assert.equal(restoreRuntimePreference({ modelId: gpu }, false).modelId, gpu);
  assert.equal(getChatModel(restoreRuntimePreference(null, false).modelId).backend, "webgpu");
});

test("explicit CPU choices remain available while GPU selection resets the CPU opt-in", () => {
  const choice = selectedRuntimePreference(defaultCpuModel);
  assert.equal(choice.cpuExplicitChoice, true); assert.deepEqual(restoreRuntimePreference(choice, false), choice);
  const gpu = selectedRuntimePreference(defaultConversationModel);
  assert.equal(gpu.cpuExplicitChoice, false); assert.deepEqual(restoreRuntimePreference(gpu, false), gpu);
  assert.throws(() => selectedRuntimePreference("unknown"), /unsupported_model/);
  assert.equal(restoreRuntimePreference({ modelId: defaultCpuModel }, true).modelId, defaultCpuModel);
  assert.equal(restoreRuntimePreference(null, true).modelId, defaultPhoneGpuModel);
});

test("processor labels describe the loaded model and cannot turn an unknown model into a GPU claim", () => {
  assert.equal(runtimeLabel(defaultConversationModel), "GPU · WebGPU");
  assert.equal(runtimeLabel(defaultCpuModel), "CPU · WebAssembly");
  assert.equal(runtimeLabel(null), ""); assert.equal(runtimeLabel("unknown"), "");
});

test("a failed GPU load preserves the GPU error and never calls the CPU loader", async () => {
  let gpu = 0, cpu = 0; const failure = Error("model_resources_webgpu");
  const loader = createConversationLoader({ gpu: async () => { gpu++; throw failure; }, cpu: async () => { cpu++; throw Error("Unexpected CPU fallback"); } });
  const session = new ConversationSession({ load: loader });
  await assert.rejects(session.load(defaultConversationModel), error => error === failure);
  assert.equal(gpu, 1); assert.equal(cpu, 0); assert.equal(session.ready, false);
  assert.equal(session.getSnapshot().modelId, defaultConversationModel);
  assert.equal(session.getSnapshot().status, "error"); assert.equal(session.getSnapshot().error, failure.message);
  session.unload();
});

test("CPU inference starts only after a CPU model is selected and the loader never downloads an unknown model", async () => {
  const calls = [];
  const runtime = modelId => ({ modelId, dispose() {}, adapter: { interrupt() {}, async stream() { return (async function* () { yield { choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] }; })(); } } });
  const loader = createConversationLoader({ gpu: async id => { calls.push("gpu"); return runtime(id); }, cpu: async id => { calls.push("cpu"); return runtime(id); } });
  const session = new ConversationSession({ load: loader });
  await session.load(defaultConversationModel); assert.deepEqual(calls, ["gpu"]);
  assert.equal((await session.generate({ text: "Hello", locale: "en" })).text, "Hello");
  await session.load(selectedRuntimePreference(defaultCpuModel).modelId); assert.deepEqual(calls, ["gpu", "cpu"]);
  await assert.rejects(loader("not-a-model", { signal: new AbortController().signal, onProgress() {}, onFatal() {} }), /unsupported_model/);
  assert.deepEqual(calls, ["gpu", "cpu"]); session.unload();
});

const limits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
test("known software WebGPU adapters fail the GPU gate before download and leave explicit CPU mode usable", async () => {
  const model = getConversationModel(defaultPhoneGpuModel), signal = new AbortController().signal;
  for (const adapter of [{ isFallbackAdapter: true, info: {} }, { info: { isFallbackAdapter: true } }, { info: { description: "Google SwiftShader" } }, { info: { description: "Mesa llvmpipe" } }, { info: { description: "Microsoft Basic Render Driver" } }]) {
    const measured = await inspectDevice({ hardwareConcurrency: 8, deviceMemory: 16, gpu: { requestAdapter: async () => ({ features: ["shader-f16"], limits, ...adapter }) } }, { workerAvailable: true });
    assert.equal(measured.softwareGpu, true);
    assert.ok(assessModel(model, measured, { ramGB: 16, gpuGB: 8 }).blockers.includes("software-gpu"));
    let started = false;
    await assert.rejects(withModelResources(model, { signal, inspect: async () => measured }, async () => { started = true; }), /model_resources_software-gpu/);
    assert.equal(started, false); assert.equal(assessCpuModel(cpuModels[0], measured, { ramGB: 16 }).blockers.length, 0);
  }
});

test("private or integrated GPU labels do not become a software-adapter rejection", async () => {
  const model = getConversationModel(defaultPhoneGpuModel);
  for (const description of ["NVIDIA RTX", "AMD Radeon", "Intel Iris Xe", "Apple GPU", ""]) {
    const measured = await inspectDevice({ hardwareConcurrency: 8, deviceMemory: 16, gpu: { requestAdapter: async () => ({ info: { description }, features: ["shader-f16"], limits }) } }, { workerAvailable: true });
    assert.equal(measured.softwareGpu, false);
    assert.equal(assessModel(model, measured, { ramGB: 16, gpuGB: 8 }).status, "suitable");
  }
  for (const locale of ["en", "de"]) assert.match(conversationError("model_resources_software-gpu", locale), /Software|software/);
});
