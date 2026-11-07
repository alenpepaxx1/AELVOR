// Copyright © 2026 Alen Pepa
import type { CatalogModel } from "./model-catalog.ts";
import { mobileProfile, mobileExecutionLimits, mobileMemoryCeilings, type MobileProfile, type MobileNavigator } from "./mobile-device.ts";
import { gpuVendor, isSoftwareGpu, type GpuVendor } from "./gpu-identity.ts";
import { gpuSelectionIssue, type GpuPreference } from "./gpu-selection.ts";
import { gpuBudgetMatches } from "./hardware-budget.ts";
export { gpuVendor, isSoftwareGpu } from "./gpu-identity.ts";
export type { GpuVendor } from "./gpu-identity.ts";

export type DeviceBudget = { ramGB?: number; gpuGB?: number; gpuBinding?: string };
export type CpuExecution = { wasm: boolean; simd: boolean; threads: number };
export type DeviceCapabilities = {
  checkedAt: number; cpuThreads: number | null; ramEstimateGB: number | null;
  gpu: "available" | "unavailable" | "unknown"; gpuName: string; features: string[];
  maxBufferBytes: number | null; maxStorageBufferBytes: number | null;
  maxComputeWorkgroupStorageBytes: number | null; maxStorageBuffersPerStage: number | null;
  cacheAvailableGB: number | null; workerAvailable: boolean;
  cpu?: CpuExecution; gpuVendor?: GpuVendor; softwareGpu?: boolean;
  mobile?: MobileProfile;
  os?: "windows" | "macos" | "linux" | "android" | "ios" | "unknown";
};
type Adapter = { isFallbackAdapter?: boolean; info?: { description?: string; vendor?: string; architecture?: string; isFallbackAdapter?: boolean }; features?: Iterable<string>; limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number; maxComputeWorkgroupStorageSize?: number; maxStorageBuffersPerShaderStage?: number } };
export type DeviceNavigator = MobileNavigator & { hardwareConcurrency?: number; deviceMemory?: number; gpu?: { requestAdapter: (options?: { powerPreference: string }) => Promise<Adapter | null> }; storage?: { estimate: () => Promise<{ quota?: number; usage?: number }> } };
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const readPositive = (read: () => unknown): number | null => { try { return positive(read()); } catch { return null; } };

type CpuEnvironment = { WebAssembly?: Pick<typeof WebAssembly, "validate">; crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown };
export function inspectCpuExecution(threads: number | null, environment: CpuEnvironment = globalThis): CpuExecution {
  let wasm = false, simd = false, shared = false;
  try {
    wasm = typeof environment.WebAssembly?.validate === "function" && environment.WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    simd = wasm && environment.WebAssembly!.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    shared = environment.crossOriginIsolated === true && typeof environment.SharedArrayBuffer === "function";
  } catch { /* Restricted browser APIs cannot advertise CPU capabilities. */ }
  return { wasm, simd, threads: shared ? Math.max(1, Math.min(8, Math.floor(positive(threads) || 1))) : 1 };
}

// The installed SDK's detectGPUDevice() requests these minimum limits. Review
// this contract when upgrading WebLLM; the catalog-version test enforces that.
export const runtimeGpuRequirements = { sdkVersion: "0.2.86", maxBufferBytes: 2 ** 28, maxStorageBufferBytes: 2 ** 27, maxComputeWorkgroupStorageBytes: 32 * 1024, maxStorageBuffersPerStage: 10 } as const;
export function runtimeBufferLimits(device: DeviceCapabilities) {
  const requested = (available: number | null, fallback: number) => available === null || available === undefined ? null : available >= 2 ** 30 ? 2 ** 30 : available >= fallback ? fallback : null;
  return { maxBufferBytes: requested(device.maxBufferBytes, runtimeGpuRequirements.maxBufferBytes), maxStorageBufferBytes: requested(device.maxStorageBufferBytes, runtimeGpuRequirements.maxStorageBufferBytes) };
}
export function normalizeDeviceBudget(input: unknown): DeviceBudget {
  const value = input as DeviceBudget | null;
  const ram = positive(value?.ramGB), gpu = positive(value?.gpuGB);
  const binding = typeof value?.gpuBinding === "string" && value.gpuBinding.trim().length <= 256 && !/[\u0000-\u001f\u007f]/.test(value.gpuBinding) ? value.gpuBinding.trim() : "";
  return { ...(ram && ram >= 1 && ram <= 1024 ? { ramGB: ram } : {}), ...(gpu && gpu >= 0.25 && gpu <= 512 ? { gpuGB: gpu, ...(binding ? { gpuBinding: binding } : {}) } : {}) };
}

async function bounded<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("device_probe_timeout")), timeoutMs); })]); }
  finally { clearTimeout(timer!); }
}

export async function inspectDevice(nav: DeviceNavigator = navigator as DeviceNavigator, options: { workerAvailable?: boolean; timeoutMs?: number } = {}): Promise<DeviceCapabilities> {
  const result: DeviceCapabilities = { checkedAt: Date.now(), cpuThreads: readPositive(() => nav.hardwareConcurrency), ramEstimateGB: readPositive(() => nav.deviceMemory), gpu: "unknown", gpuName: "", features: [], maxBufferBytes: null, maxStorageBufferBytes: null, maxComputeWorkgroupStorageBytes: null, maxStorageBuffersPerStage: null, cacheAvailableGB: null, workerAvailable: options.workerAvailable ?? typeof Worker !== "undefined" };
  const timeout = options.timeoutMs ?? 6000;
  result.cpu = inspectCpuExecution(result.cpuThreads); result.gpuVendor = "unknown";
  result.mobile = mobileProfile(nav);
  try {
    const hints = `${nav.userAgent || ""} ${nav.platform || ""} ${nav.userAgentData?.platform || ""}`;
    result.os = ["iphone", "ipad"].includes(result.mobile.family) ? "ios" : ["samsung", "android"].includes(result.mobile.family) ? "android" : /Windows|Win32|Win64/i.test(hints) ? "windows" : /Macintosh|MacIntel|Mac OS/i.test(hints) ? "macos" : /Linux|X11|CrOS/i.test(hints) ? "linux" : "unknown";
  } catch { result.os = "unknown"; }
  result.cpu.threads = Math.min(result.cpu.threads, mobileExecutionLimits(result.mobile, "cpu", 4096).maxCpuThreads);
  await Promise.all([
    (async () => {
      try {
        const gpu = nav.gpu;
        if (!gpu) { result.gpu = "unavailable"; return; }
        const adapter = await bounded(gpu.requestAdapter({ powerPreference: "high-performance" }), timeout);
        if (!adapter) { result.gpu = "unavailable"; return; }
        result.gpu = "available";
        result.features = Array.from(adapter.features || []);
        result.maxBufferBytes = positive(adapter.limits?.maxBufferSize);
        result.maxStorageBufferBytes = positive(adapter.limits?.maxStorageBufferBindingSize);
        result.maxComputeWorkgroupStorageBytes = positive(adapter.limits?.maxComputeWorkgroupStorageSize);
        result.maxStorageBuffersPerStage = positive(adapter.limits?.maxStorageBuffersPerShaderStage);
        try { result.softwareGpu = adapter.isFallbackAdapter === true; } catch { /* Older/private adapter flags are optional. */ }
        try {
          const info = adapter.info;
          result.gpuName = (info?.description || [info?.vendor, info?.architecture].filter(Boolean).join(" ")).slice(0, 256);
          result.gpuVendor = gpuVendor(`${info?.vendor || ""} ${result.gpuName}`);
          result.softwareGpu = result.softwareGpu || info?.isFallbackAdapter === true || isSoftwareGpu(`${info?.vendor || ""} ${result.gpuName}`);
        } catch { /* A private GPU label must not erase measured capabilities. */ }
      } catch { result.gpu = "unknown"; }
    })(),
    (async () => {
      try {
        if (!nav.storage) return;
        const { quota, usage } = await bounded(nav.storage.estimate(), timeout);
        if (positive(quota) && typeof usage === "number" && Number.isFinite(usage) && usage >= 0) result.cacheAvailableGB = Math.max(0, quota! - usage) / 1e9;
      } catch { /* Storage estimates are optional and never a measure of RAM. */ }
    })(),
  ]);
  return result;
}

export type CompatibilityIssue = "webgpu" | "probe" | "worker" | "features" | "buffer" | "runtime-limits" | "gpu-budget" | "ram-budget" | "gpu-unknown" | "ram-unknown" | "memory-unknown" | "ram-estimate" | "cpu" | "storage" | "mobile-memory" | "software-gpu" | "gpu-selection" | "gpu-budget-device";
export type CompatibilityReport = { status: "blocked" | "caution" | "suitable"; blockers: CompatibilityIssue[]; warnings: CompatibilityIssue[]; missingFeatures: string[]; gpuPlanningGB: number; ramPlanningGB: number };
export function assessModel(model: CatalogModel, device: DeviceCapabilities, input: DeviceBudget = {}, gpuPreference: GpuPreference = "auto"): CompatibilityReport {
  const budget = normalizeDeviceBudget(input), blockers: CompatibilityIssue[] = [], warnings: CompatibilityIssue[] = [];
  const gpuPlanningGB = Math.ceil(model.memoryGB * 1.2 * 10) / 10;
  const ramPlanningGB = Math.max(4, Math.ceil(model.memoryGB * 1.5 + 2));
  const missingFeatures = model.requiredFeatures.filter(feature => !device.features.includes(feature));
  const mobileCeilings = mobileMemoryCeilings(device.mobile);
  if (mobileCeilings && gpuPlanningGB > mobileCeilings.gpuPlanningGB) blockers.push("mobile-memory");
  if (device.gpu === "unavailable") blockers.push("webgpu");
  else if (device.gpu !== "available") blockers.push("probe");
  if (!device.workerAvailable) blockers.push("worker");
  if (device.gpu === "available" && missingFeatures.length) blockers.push("features");
  if (device.gpu === "available") {
    if (device.softwareGpu) blockers.push("software-gpu");
    if (gpuSelectionIssue(device, gpuPreference)) blockers.push("gpu-selection");
    const limits = ["maxBufferBytes", "maxStorageBufferBytes", "maxComputeWorkgroupStorageBytes", "maxStorageBuffersPerStage"] as const;
    if (limits.some(key => positive(device[key]) === null)) blockers.push("probe");
    if (limits.some(key => positive(device[key]) !== null && device[key]! < runtimeGpuRequirements[key])) blockers.push("runtime-limits");
    const requested = runtimeBufferLimits(device);
    if (model.bufferBytes && ((requested.maxStorageBufferBytes !== null && model.bufferBytes > requested.maxStorageBufferBytes) || (requested.maxBufferBytes !== null && model.bufferBytes > requested.maxBufferBytes))) blockers.push("buffer");
  }
  if (budget.gpuGB !== undefined && gpuPlanningGB > budget.gpuGB) blockers.push("gpu-budget");
  if (budget.gpuBinding && !gpuBudgetMatches(budget.gpuBinding, device)) blockers.push("gpu-budget-device");
  if (budget.ramGB !== undefined && ramPlanningGB > budget.ramGB) blockers.push("ram-budget");
  // Large models require declared budgets when the browser cannot establish
  // capacity. A small browser RAM estimate is a conservative gate, not proof
  // that the physical computer has that little RAM (the API may be capped).
  if (budget.gpuGB === undefined && gpuPlanningGB > 3) blockers.push("gpu-unknown");
  if (budget.ramGB === undefined && device.ramEstimateGB === null && gpuPlanningGB > 2) blockers.push("ram-unknown");
  if (budget.gpuGB === undefined || budget.ramGB === undefined) warnings.push("memory-unknown");
  if (budget.ramGB === undefined && device.ramEstimateGB !== null && ramPlanningGB > device.ramEstimateGB) blockers.push("ram-estimate");
  if (device.cpuThreads === null || device.cpuThreads < 4) warnings.push("cpu");
  if (model.downloadGB !== null && device.cacheAvailableGB !== null && model.downloadGB * 1.15 > device.cacheAvailableGB) warnings.push("storage");
  return { status: blockers.length ? "blocked" : warnings.length ? "caution" : "suitable", blockers, warnings, missingFeatures, gpuPlanningGB, ramPlanningGB };
}

export function requireModelResources(model: CatalogModel, device: DeviceCapabilities, budget: DeviceBudget = {}, gpuPreference: GpuPreference = "auto"): CompatibilityReport {
  const report = assessModel(model, device, budget, gpuPreference);
  if (report.blockers.length) throw new Error(`model_resources_${report.blockers[0]}`);
  return report;
}
