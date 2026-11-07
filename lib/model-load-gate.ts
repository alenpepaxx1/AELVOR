// Copyright © 2026 Alen Pepa
import { aborted, abortable } from "./conversation.ts";
import { inspectDevice, normalizeDeviceBudget, requireModelResources, type DeviceBudget, type DeviceCapabilities } from "./device-capabilities.ts";
import type { CatalogModel } from "./model-catalog.ts";
import type { GpuPreference } from "./gpu-selection.ts";

export async function withModelResources<T>(model: CatalogModel, options: { signal: AbortSignal; budget?: DeviceBudget; gpuPreference?: GpuPreference; inspect?: () => Promise<DeviceCapabilities> }, start: (device: DeviceCapabilities) => Promise<T>): Promise<T> {
  if (options.signal.aborted) throw aborted();
  const budget = normalizeDeviceBudget(options.budget);
  const device = await abortable((options.inspect ?? inspectDevice)(), options.signal);
  requireModelResources(model, device, budget, options.gpuPreference);
  if (options.signal.aborted) throw aborted();
  return start(device);
}
