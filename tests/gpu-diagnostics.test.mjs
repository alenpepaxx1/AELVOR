// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseGpu, gpuHelpNeeded } from "../lib/gpu-diagnostics.ts";
import { loadedGpuFromProgress } from "../lib/gpu-selection.ts";

const device = { gpu: "available", gpuName: "NVIDIA GeForce RTX 4060", gpuVendor: "nvidia", os: "windows" };
const input = { device, checking: false, preference: "auto" };
const loaded = name => loadedGpuFromProgress({ progress: 1, text: `Finish loading on WebGPU - ${name}` });
const cases = [
  ["a pending recheck does not diagnose stale hardware or an old worker error", { checking: true, device: null, preference: "nvidia", runtimeError: "gpu_selection_nvidia_mismatch" }, "checking"],
  ["unavailable WebGPU offers help even in Automatic mode", { device: { ...device, gpu: "unavailable" } }, "unavailable"],
  ["an incomplete probe offers help", { device: null }, "unavailable"],
  ["a software adapter cannot look like healthy physical graphics", { device: { ...device, gpuName: "SwiftShader", softwareGpu: false } }, "software"],
  ["the fallback flag opens help independently of the reported vendor", { device: { ...device, softwareGpu: true } }, "software"],
  ["a required NVIDIA GPU explains an integrated Intel mismatch", { preference: "nvidia", device: { ...device, gpuName: "Intel UHD Graphics 770", gpuVendor: "intel" } }, "requirement"],
  ["a private identity cannot confirm a required vendor", { preference: "nvidia", device: { ...device, gpuName: "", gpuVendor: "unknown" } }, "requirement"],
  ["hidden GPU identity stays distinct from absent hardware", { device: { ...device, gpuName: "", gpuVendor: "unknown" } }, "identity-hidden"],
  ["a manufacturer-only label does not confirm a physical model", { device: { ...device, gpuName: "NVIDIA" } }, "identity-hidden"],
  ["known integrated Intel in Automatic mode offers dedicated-GPU help", { device: { ...device, gpuName: "Intel Iris Xe Graphics", gpuVendor: "intel" } }, "integrated"],
  ["Intel Arc is not assumed to be integrated", { device: { ...device, gpuName: "Intel Arc A770", gpuVendor: "intel" } }, "ready"],
  ["dedicated Intel Iris Xe MAX is not classified as integrated Iris", { device: { ...device, gpuName: "Intel Iris Xe MAX", gpuVendor: "intel" } }, "ready"],
  ["Apple silicon does not need an RTX card", { device: { ...device, gpuName: "Apple M4", gpuVendor: "apple", os: "macos" } }, "ready"],
  ["phone built-in graphics do not trigger desktop routing help", { device: { ...device, gpuName: "Apple integrated GPU", gpuVendor: "apple", os: "ios" } }, "ready"],
  ["generic Radeon does not prove that a dedicated GPU is missing", { device: { ...device, gpuName: "AMD Radeon Graphics", gpuVendor: "amd" } }, "ready"],
  ["worker rejection is visible despite a matching browser probe", { preference: "nvidia", runtimeError: "gpu_selection_nvidia_mismatch" }, "worker"],
  ["an unknown loaded manufacturer cannot satisfy an explicit requirement", { preference: "nvidia", loadedGpu: loaded("") }, "worker"],
  ["a GPU lost event opens recovery steps", { runtimeError: "GPU lost" }, "worker"],
  ["a loaded Intel model and new NVIDIA probe need an explicit reload", { loadedGpu: loaded("Intel Iris Xe") }, "different-adapters"],
  ["different SDK wording of the same vendor is not proof of a GPU switch", { loadedGpu: loaded("NVIDIA RTX 4060") }, "ready"],
  ["an RTX budget cannot be applied to a newly exposed Intel GPU", { device: { ...device, gpuName: "Intel Iris Xe", gpuVendor: "intel" }, gpuBinding: device.gpuName }, "budget"],
  ["a rejected worker budget still needs help after a healthy probe", { runtimeError: "model_resources_gpu-budget-device" }, "budget"],
  ["download failures are not diagnosed as GPU activation failures", { runtimeError: "Failed to fetch WebGPU runtime library" }, "ready"],
  ["a context error does not trigger graphics activation steps", { runtimeError: "conversation_input_too_long" }, "ready"],
  ["too little VRAM needs a smaller model, not an invented disabled GPU", { runtimeError: "model_resources_gpu-budget" }, "ready"],
];
for (const [name, overrides, expected] of cases) test(name, () => {
  const result = diagnoseGpu({ ...input, ...overrides });
  assert.equal(result, expected);
  assert.equal(gpuHelpNeeded(result), expected !== "checking" && expected !== "ready");
});
