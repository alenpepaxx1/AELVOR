// Copyright © 2026 Alen Pepa
export const GiB = 2 ** 30;
export function hardwareFixture() {
  return { format: "aelvor-hardware", version: 1, os: "windows", generatedAt: "2026-10-31T20:00:00.1234567Z", cpus: [{ name: "Intel Core i7-14700K", manufacturer: "GenuineIntel", cores: 20, logicalProcessors: 28 }, { name: "AMD Ryzen 9 9950X 16-Core Processor", manufacturer: "AuthenticAMD", cores: 16, logicalProcessors: 32 }], ram: { installedBytes: 64 * GiB, visibleBytes: 63 * GiB, availableBytes: 32 * GiB }, gpus: [{ id: "gpu-0", name: "NVIDIA GeForce RTX 4090", vendor: "nvidia", dedicatedBytes: 24 * GiB, sharedBytes: 32 * GiB, software: false, source: "dxgi" }, { id: "gpu-1", name: "Intel UHD Graphics 770", vendor: "intel", dedicatedBytes: 128 * 2 ** 20, sharedBytes: 32 * GiB, software: false, source: "dxgi" }, { id: "gpu-2", name: "AMD Radeon RX 7900 XTX", vendor: "amd", dedicatedBytes: 24 * GiB, sharedBytes: 32 * GiB, software: false, source: "dxgi" }, { id: "gpu-3", name: "NVIDIA disabled controller", vendor: "nvidia", dedicatedBytes: null, sharedBytes: null, software: null, source: "cim" }], warnings: [] };
}
export function hardwareBrowser(gpuName = "NVIDIA GeForce RTX 4090") {
  return { checkedAt: 1, cpuThreads: 28, ramEstimateGB: 8, os: "windows", gpu: "available", gpuName, features: ["shader-f16"], maxBufferBytes: 2 ** 30, maxStorageBufferBytes: 2 ** 30, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 100, workerAvailable: true, mobile: { family: "desktop", mobile: false } };
}
