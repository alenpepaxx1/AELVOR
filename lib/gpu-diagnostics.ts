// Copyright © 2026 Alen Pepa
import type { DeviceCapabilities } from "./device-capabilities.ts";
import { gpuSelectionIssue, type GpuPreference, type RuntimeGpuInfo } from "./gpu-selection.ts";
import { gpuVendor, isSoftwareGpu } from "./gpu-identity.ts";
import { gpuBudgetMatches } from "./hardware-budget.ts";

export type GpuDiagnostic = "checking" | "ready" | "unavailable" | "software" | "requirement" | "integrated" | "identity-hidden" | "worker" | "different-adapters" | "budget";
export type GpuDiagnosticInput = { device: DeviceCapabilities | null; checking: boolean; preference: GpuPreference; loadedGpu?: RuntimeGpuInfo; runtimeError?: string; gpuBinding?: string };

// Help is separate from the compatibility gate: integrated graphics remain
// usable in Automatic mode, and an undisclosed model is never an absent card.
export function diagnoseGpu({ device, checking, preference, loadedGpu, runtimeError = "", gpuBinding }: GpuDiagnosticInput): GpuDiagnostic {
  if (checking) return "checking";
  if (/^gpu_selection_(nvidia|amd|intel)_(unknown|mismatch)$/.test(runtimeError)) return "worker";
  if (runtimeError === "model_resources_gpu-budget-device") return "budget";
  if (runtimeError === "model_resources_software-gpu") return "software";
  if (runtimeError === "model_resources_gpu-selection") return "requirement";
  if (/^(?:model_resources_(?:webgpu|probe)|webgpu_unavailable|gpu_unavailable)$/.test(runtimeError)
    || /\b(?:device|gpu)[ _-](?:lost|unavailable)\b/i.test(runtimeError)) return "worker";
  if (!device || device.gpu !== "available") return "unavailable";
  if (device.softwareGpu || isSoftwareGpu(device.gpuName) || loadedGpu?.software) return "software";
  if (gpuBinding && !gpuBudgetMatches(gpuBinding, device)) return "budget";
  if (loadedGpu && gpuSelectionIssue({ gpuName: loadedGpu.name, gpuVendor: loadedGpu.vendor }, preference)) return "worker";
  if (gpuSelectionIssue(device, preference)) return "requirement";
  const vendor = device.gpuVendor && device.gpuVendor !== "unknown" ? device.gpuVendor : gpuVendor(device.gpuName);
  if (loadedGpu && vendor !== "unknown" && loadedGpu.vendor !== "unknown" && vendor !== loadedGpu.vendor) return "different-adapters";
  if (vendor === "unknown" || !device.gpuName.trim() || /^(?:nvidia|amd|intel|apple|qualcomm|arm|samsung)$/i.test(device.gpuName.trim())
    || (loadedGpu && (loadedGpu.vendor === "unknown" || !loadedGpu.name.trim()))) return "identity-hidden";
  const phone = device.mobile?.mobile || device.os === "ios" || device.os === "android";
  if (!phone && ((vendor === "intel" && /\b(?:iris|uhd|hd graphics)\b/i.test(device.gpuName) && !/\biris\s+xe\s+max\b/i.test(device.gpuName)) || /\bintegrated\b/i.test(device.gpuName))) return "integrated";
  return "ready";
}

export function gpuHelpNeeded(diagnostic: GpuDiagnostic): boolean {
  return diagnostic !== "checking" && diagnostic !== "ready";
}
