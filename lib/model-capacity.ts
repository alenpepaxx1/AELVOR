// Copyright © 2026 Alen Pepa
import { getConversationModel } from "./model-catalog.ts";
import { assessModel, type DeviceBudget, type DeviceCapabilities } from "./device-capabilities.ts";
import type { GpuPreference } from "./gpu-selection.ts";

// A bounded, multilingual shortlist from the installed runtime, ordered by
// parameter count and then FP16/FP32. Capacity is not an answer-quality score.
// All normal gates, including the phone ceiling, apply before suggesting it.
const candidates = [
  "Qwen3-8B-q4f16_1-MLC", "Qwen3-8B-q4f32_1-MLC",
  "Qwen2.5-7B-Instruct-q4f16_1-MLC", "Qwen2.5-7B-Instruct-q4f32_1-MLC",
  "Qwen3-4B-q4f16_1-MLC", "Qwen3-4B-q4f32_1-MLC",
  "Qwen2.5-3B-Instruct-q4f16_1-MLC", "Qwen2.5-3B-Instruct-q4f32_1-MLC",
  "Qwen3-1.7B-q4f16_1-MLC", "Qwen3-1.7B-q4f32_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  "Qwen3-0.6B-q4f16_1-MLC", "Qwen3-0.6B-q4f32_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
];
export function gpuCapacitySuggestion(device: DeviceCapabilities, budget: DeviceBudget = {}, preference: GpuPreference = "auto") {
  for (const id of candidates) {
    const model = getConversationModel(id);
    if (model && assessModel(model, device, budget, preference).status !== "blocked") return model;
  }
  return null;
}
