// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeGpuPreference, gpuSelectionIssue, loadedGpuFromProgress, requireLoadedGpu } from "../lib/gpu-selection.ts";
import { inspectDevice, assessModel, gpuVendor } from "../lib/device-capabilities.ts";
import { withModelResources } from "../lib/model-load-gate.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { gpuCapacitySuggestion } from "../lib/model-capacity.ts";
import { conversationError } from "../lib/conversation-errors.ts";

const limits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
const device = async description => inspectDevice({ hardwareConcurrency: 16, deviceMemory: 32, gpu: { requestAdapter: async options => { assert.equal(options.powerPreference, "high-performance"); return { info: { description }, features: ["shader-f16"], limits }; } } }, { workerAvailable: true });
const budget = { ramGB: 32, gpuGB: 12 };

test("GPU requirements default to automatic and recognize NVIDIA RTX labels without guessing undisclosed hardware", () => {
  for (const value of [undefined, null, false, "rtx-4090", {}, "NVIDIA"]) assert.equal(normalizeGpuPreference(value), "auto");
  for (const value of ["auto", "nvidia", "amd", "intel"]) assert.equal(normalizeGpuPreference(value), value);
  for (const name of ["NVIDIA GeForce RTX 4060 Laptop GPU", "GeForce RTX 4070", "Quadro", "0x10de"]) assert.equal(gpuVendor(name), "nvidia");
  assert.equal(gpuSelectionIssue({ gpuVendor: "intel", gpuName: "Intel Iris Xe" }, "nvidia"), "mismatch");
  assert.equal(gpuSelectionIssue({ gpuName: "" }, "nvidia"), "unknown");
  assert.equal(gpuSelectionIssue({ gpuName: "" }, "auto"), null);
});

test("an NVIDIA requirement blocks Intel before download regardless of the VRAM budget", async () => {
  const intel = await device("Intel Iris Xe"), model = getConversationModel(defaultConversationModel);
  let started = 0;
  const report = assessModel(model, intel, budget, "nvidia");
  assert.ok(report.blockers.includes("gpu-selection"));
  await assert.rejects(withModelResources(model, { signal: new AbortController().signal, inspect: async () => intel, budget, gpuPreference: "nvidia" }, async () => { started++; }), /model_resources_gpu-selection/);
  assert.equal(started, 0); assert.equal(gpuCapacitySuggestion(intel, budget, "nvidia"), null);
  assert.notEqual(assessModel(model, intel, budget).status, "blocked");
  const nvidia = await device("NVIDIA GeForce RTX 4060 Laptop GPU");
  await withModelResources(model, { signal: new AbortController().signal, inspect: async () => nvidia, budget, gpuPreference: "nvidia" }, async () => { started++; });
  assert.equal(started, 1);
});

test("GPU requirements preserve feature, memory and private-label gates for all supported vendors", async () => {
  const model = getConversationModel(defaultConversationModel);
  for (const [name, preference] of [["NVIDIA RTX 4060", "nvidia"], ["AMD Radeon RX 7800", "amd"], ["Intel Arc A770", "intel"]]) {
    const measured = await device(name);
    assert.notEqual(assessModel(model, measured, budget, preference).status, "blocked");
    assert.ok(assessModel(model, measured, { ramGB: 32, gpuGB: 0.5 }, preference).blockers.includes("gpu-budget"));
    assert.ok(assessModel(model, { ...measured, maxBufferBytes: 1 }, budget, preference).blockers.includes("runtime-limits"));
  }
  const privateGpu = await device("");
  assert.equal(assessModel(model, privateGpu, budget, "nvidia").status, "blocked");
  assert.notEqual(assessModel(model, privateGpu, budget, "auto").status, "blocked");
});

test("only the pinned SDK's terminal model-worker report identifies the loaded GPU", () => {
  assert.equal(loadedGpuFromProgress({ progress: 0.99, text: "Finish loading on WebGPU - NVIDIA RTX 4060" }), undefined);
  assert.equal(loadedGpuFromProgress({ progress: 1, text: "NVIDIA selected by user" }), undefined);
  const actual = loadedGpuFromProgress({ progress: 1, text: "Finish loading on WebGPU - NVIDIA GeForce RTX 4060 Laptop GPU" });
  assert.equal(actual.name, "NVIDIA GeForce RTX 4060 Laptop GPU");
  assert.equal(actual.vendor, "nvidia"); assert.equal(actual.source, "model-worker");
  assert.doesNotThrow(() => requireLoadedGpu(actual, "nvidia"));
  const intel = loadedGpuFromProgress({ progress: 1, text: "Finish loading on WebGPU - Intel Iris Xe" });
  assert.throws(() => requireLoadedGpu(intel, "nvidia"), /gpu_selection_nvidia_mismatch/);
  assert.throws(() => requireLoadedGpu(undefined, "nvidia"), /gpu_selection_nvidia_unknown/);
  assert.doesNotThrow(() => requireLoadedGpu(undefined, "auto"));
  const software = loadedGpuFromProgress({ progress: 1, text: "Finish loading on WebGPU - Google SwiftShader" });
  assert.throws(() => requireLoadedGpu(software), /model_resources_software-gpu/);
});

test("the SDK report contract still derives its label from the device that initializes model inference", async () => {
  const sdk = await readFile(new URL("../node_modules/@mlc-ai/web-llm/lib/index.js", import.meta.url), "utf8");
  const start = sdk.indexOf("// detect GPU\n            const gpuDetectOutput =");
  const end = sdk.indexOf("const text = \"Finish loading on \" + gpuLabel;", start);
  assert.ok(start >= 0 && end > start, "Review the loaded-GPU report contract after SDK changes");
  const loading = sdk.slice(start, end);
  assert.ok(loading.includes("gpuDetectOutput.adapterInfo.description"));
  assert.ok(loading.includes("gpuDetectOutput.adapterInfo.vendor"));
  assert.ok(loading.includes("tvm.initWebGPU(gpuDetectOutput.device)"));
});

test("English and German selection errors explain Windows routing instead of suggesting fictitious GPU detection", () => {
  for (const locale of ["en", "de"]) {
    assert.match(conversationError("gpu_selection_nvidia_mismatch", locale), /NVIDIA/);
    assert.match(conversationError("gpu_selection_nvidia_unknown", locale), /Windows/);
    assert.match(conversationError("model_resources_gpu-selection", locale), /VRAM/);
  }
});
