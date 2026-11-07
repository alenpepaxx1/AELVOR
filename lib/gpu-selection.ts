// Copyright © 2026 Alen Pepa
import { gpuVendor, isSoftwareGpu, type GpuVendor } from "./gpu-identity.ts";

export type GpuPreference = "auto" | "nvidia" | "amd" | "intel";
export type RuntimeGpuInfo = { name: string; vendor: GpuVendor; software: boolean; source: "model-worker" };
type DetectedGpu = { gpuVendor?: GpuVendor; gpuName?: string };
export function normalizeGpuPreference(value: unknown): GpuPreference {
  return value === "nvidia" || value === "amd" || value === "intel" ? value : "auto";
}
export function gpuSelectionIssue(gpu: DetectedGpu | undefined, input: GpuPreference = "auto"): "unknown" | "mismatch" | null {
  const preference = normalizeGpuPreference(input);
  if (preference === "auto") return null;
  const vendor = gpu?.gpuVendor && gpu.gpuVendor !== "unknown" ? gpu.gpuVendor : gpuVendor(gpu?.gpuName || "");
  return vendor === "unknown" ? "unknown" : vendor === preference ? null : "mismatch";
}

// In pinned WebLLM 0.2.86, this terminal report is constructed from the same
// adapterInfo whose device is passed to tvm.initWebGPU in the model worker.
// getGPUVendor() makes another adapter request and is NOT that evidence.
export function loadedGpuFromProgress(report: { progress: number; text: string }): RuntimeGpuInfo | undefined {
  if (report.progress !== 1) return;
  const match = /^Finish loading on WebGPU(?: - ([\s\S]*))?$/.exec(report.text);
  if (!match) return;
  const name = (match[1] || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256);
  return { name, vendor: gpuVendor(name), software: isSoftwareGpu(name), source: "model-worker" };
}
export function requireLoadedGpu(gpu: RuntimeGpuInfo | undefined, preference: GpuPreference = "auto"): void {
  if (gpu?.software) throw Error("model_resources_software-gpu");
  const issue = gpuSelectionIssue(gpu ? { gpuVendor: gpu.vendor, gpuName: gpu.name } : undefined, preference);
  if (issue) throw Error(`gpu_selection_${normalizeGpuPreference(preference)}_${issue}`);
}
