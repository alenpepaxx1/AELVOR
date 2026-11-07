// Copyright © 2026 Alen Pepa
import { assessModel, type DeviceBudget, type DeviceCapabilities } from "./device-capabilities.ts";
import { assessCpuModel, cpuModels } from "./cpu-models.ts";
import { getConversationModel } from "./model-catalog.ts";

export const defaultPhoneGpuModel = "Qwen2.5-0.5B-Instruct-q4f32_1-MLC";
export function phoneGpuRecommendation(device: DeviceCapabilities, budget: DeviceBudget = {}) {
  if (!device.mobile?.mobile) return undefined;
  const candidates = ["Qwen2.5-0.5B-Instruct-q4f16_1-MLC", defaultPhoneGpuModel, "SmolLM2-360M-Instruct-q4f16_1-MLC", "SmolLM2-360M-Instruct-q4f32_1-MLC"];
  return candidates.map(getConversationModel).find(model => model && assessModel(model, device, budget).status !== "blocked");
}
export function phoneCpuRecommendation(device: DeviceCapabilities, budget: DeviceBudget = {}) {
  if (!device.mobile?.mobile) return undefined;
  return [cpuModels[0], cpuModels[2]].find(model => assessCpuModel(model, device, budget).status !== "blocked");
}
