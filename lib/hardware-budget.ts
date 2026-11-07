// Copyright © 2026 Alen Pepa
import type { HardwareReport } from "./hardware-report.ts";
import { gpuVendor } from "./gpu-identity.ts";

export function canonicalGpuName(name: string): string {
  return name.toLowerCase().replace(/\(r\)|\(tm\)|®|™/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
type BrowserHardware = { os?: string; mobile?: { mobile: boolean }; gpu: string; gpuName: string; softwareGpu?: boolean };
export function gpuBudgetMatches(name: string, device: Pick<BrowserHardware, "gpu" | "gpuName" | "softwareGpu">): boolean {
  const current = canonicalGpuName(device.gpuName), expected = canonicalGpuName(name);
  return device.gpu === "available" && !device.softwareGpu && current.length > 4 && current === expected;
}
export function matchingReportGpu(report: HardwareReport, device: BrowserHardware) {
  if (device.os !== report.os || device.mobile?.mobile || device.gpu !== "available" || device.softwareGpu || !device.gpuName) return null;
  const name = canonicalGpuName(device.gpuName);
  // A generic manufacturer label is not a model identity. Identical adapters
  // are ambiguous: never choose one card's VRAM by vendor or parameter guess.
  if (name.split(" ").length < 2 || !/\d/.test(name) || gpuVendor(name) === "unknown") return null;
  const matches = report.gpus.filter(gpu => canonicalGpuName(gpu.name) === name);
  return matches.length === 1 && matches[0].source === "dxgi" && matches[0].software === false ? matches[0] : null;
}
export function requireGpuBudgetMatch(budget: { gpuBinding?: string }, device: Pick<BrowserHardware, "gpu" | "gpuName" | "softwareGpu">): void {
  if (budget.gpuBinding && !gpuBudgetMatches(budget.gpuBinding, device)) throw Error("model_resources_gpu-budget-device");
}
export function reportMemoryBudget(report: HardwareReport, device: BrowserHardware, confirmedThisComputer: boolean, includeGpu: boolean) {
  if (!confirmedThisComputer || device.os !== report.os || device.mobile?.mobile) throw Error("hardware_report_device");
  const total = report.ram.installedBytes ?? report.ram.visibleBytes;
  const ramBytes = report.ram.availableBytes === null ? total : total === null ? report.ram.availableBytes : Math.min(total, report.ram.availableBytes);
  const ramGB = ramBytes === null ? undefined : Math.floor(ramBytes / 1e8) / 10;
  const match = includeGpu ? matchingReportGpu(report, device) : null;
  const gpuGB = match?.dedicatedBytes ? Math.floor(match.dedicatedBytes / 1e8) / 10 : undefined;
  return {
    ...(ramGB !== undefined && ramGB >= 1 && ramGB <= 1024 ? { ramGB } : {}),
    ...(gpuGB !== undefined && gpuGB >= 0.25 && gpuGB <= 512 ? { gpuGB, gpuBinding: device.gpuName } : {}),
  };
}
