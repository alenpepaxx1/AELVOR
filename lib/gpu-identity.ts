// Copyright © 2026 Alen Pepa
export type GpuVendor = "nvidia" | "amd" | "intel" | "apple" | "qualcomm" | "arm" | "samsung" | "unknown";
export function gpuVendor(label: string): GpuVendor {
  if (/xclipse|samsung/i.test(label)) return "samsung";
  if (/\barm\b|mali|immortalis/i.test(label)) return "arm";
  if (/nvidia|\b(?:geforce|quadro|rtx|gtx)\b|\b(?:0x)?10de\b/i.test(label)) return "nvidia";
  if (/\bamd\b|radeon|\b(?:0x)?1002\b|\b(?:0x)?1022\b/i.test(label)) return "amd";
  if (/intel|\b(?:0x)?8086\b/i.test(label)) return "intel";
  if (/apple/i.test(label)) return "apple";
  if (/qualcomm|adreno/i.test(label)) return "qualcomm";
  return "unknown";
}
export function isSoftwareGpu(label: string): boolean {
  return /swiftshader|lavapipe|llvmpipe|software\s+(?:adapter|rasterizer)|microsoft\s+(?:basic\s+render\s+driver|warp)/i.test(label);
}
