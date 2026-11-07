// Copyright © 2026 Alen Pepa
import { normalizeDeviceBudget, type DeviceBudget, type DeviceCapabilities } from "./device-capabilities.ts";
import { mobileMemoryCeilings } from "./mobile-device.ts";

export type CpuModel = { id: string; name: string; backend: "cpu"; repo: string; revision: string; weightBytes: number; downloadGB: number; ramGB: number; contextWindow: number; sourceUrl: string; modelType?: "qwen2" | "llama"; eosTokenIds?: number[]; englishOnly?: boolean };
// Publisher snapshots and weight byte counts are pinned to the original ONNX
// exports. These q8 files do not require FP16 or a vendor-specific GPU driver.
// https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/commit/516c8d04add8a80c5228f32102b57953b8d421a9
// https://huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct/commit/9f9c976052bfb08a20793f0c3013563dc095c966
export const cpuModels: readonly CpuModel[] = [
  { id: "cpu:Qwen2.5-0.5B-Instruct-q8", name: "Qwen 0.5B · CPU", backend: "cpu", repo: "onnx-community/Qwen2.5-0.5B-Instruct", revision: "516c8d04add8a80c5228f32102b57953b8d421a9", weightBytes: 512096557, downloadGB: 0.53, ramGB: 4, contextWindow: 4096, sourceUrl: "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct" },
  { id: "cpu:Qwen2.5-1.5B-Instruct-q8", name: "Qwen 1.5B · CPU", backend: "cpu", repo: "onnx-community/Qwen2.5-1.5B-Instruct", revision: "9f9c976052bfb08a20793f0c3013563dc095c966", weightBytes: 1578954293, downloadGB: 1.60, ramGB: 8, contextWindow: 4096, sourceUrl: "https://huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct" },
  { id: "cpu:SmolLM2-135M-Instruct-q8", name: "SmolLM2 135M · CPU", backend: "cpu", repo: "onnx-community/SmolLM2-135M-Instruct-ONNX", revision: "b8a5c0f183b78c55955a5364f610c36668b5e681", weightBytes: 135658354, downloadGB: 0.15, ramGB: 2, contextWindow: 4096, sourceUrl: "https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX", modelType: "llama", eosTokenIds: [2], englishOnly: true },
];
export const defaultCpuModel = cpuModels[0].id;
export const defaultPhoneCpuModel = cpuModels[2].id;
export const cpuRuntimeVersion = "3.8.1";
export const cpuRuntimeDirectory = `/ai-runtime/transformers-${cpuRuntimeVersion}/`;
export function getCpuModel(id: unknown): CpuModel | undefined { return typeof id === "string" ? cpuModels.find(model => model.id === id) : undefined; }
export function cpuModelBaseUrl(model: CpuModel): string { return `https://huggingface.co/${model.repo}/resolve/${model.revision}/`; }
export type CpuIssue = "wasm" | "simd" | "worker" | "ram-unknown" | "ram-budget" | "cpu-speed" | "single-thread" | "storage" | "mobile-memory";
export type CpuReport = { status: "blocked" | "caution" | "suitable"; blockers: CpuIssue[]; warnings: CpuIssue[]; ramPlanningGB: number; threads: number };
export function assessCpuModel(model: CpuModel, device: DeviceCapabilities, budget: DeviceBudget = {}): CpuReport {
  const blockers: CpuIssue[] = [], warnings: CpuIssue[] = [];
  if (!device.cpu?.wasm) blockers.push("wasm");
  else if (!device.cpu.simd) blockers.push("simd");
  if (!device.workerAvailable) blockers.push("worker");
  const ram = normalizeDeviceBudget(budget).ramGB ?? device.ramEstimateGB;
  if (ram === null || ram === undefined) (device.mobile?.mobile && model.weightBytes < 200_000_000 ? warnings : blockers).push("ram-unknown");
  else if (ram < model.ramGB) blockers.push("ram-budget");
  const ceiling = mobileMemoryCeilings(device.mobile);
  if (ceiling && model.weightBytes > ceiling.cpuWeightBytes) blockers.push("mobile-memory");
  if (!device.cpuThreads || device.cpuThreads < 4) warnings.push("cpu-speed");
  if ((device.cpu?.threads || 1) === 1) warnings.push("single-thread");
  if (device.cacheAvailableGB !== null && device.cacheAvailableGB < model.downloadGB * 1.15) warnings.push("storage");
  return { status: blockers.length ? "blocked" : warnings.length ? "caution" : "suitable", blockers, warnings, ramPlanningGB: model.ramGB, threads: device.cpu?.threads || 1 };
}
export function requireCpuResources(model: CpuModel, device: DeviceCapabilities, budget: DeviceBudget = {}): CpuReport {
  const report = assessCpuModel(model, device, budget);
  if (report.blockers.length) throw new Error(`cpu_resources_${report.blockers[0]}`);
  return report;
}
