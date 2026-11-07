// Copyright © 2026 Alen Pepa
import { getChatModel } from "./chat-models.ts";
import { defaultConversationModel } from "./conversation.ts";
import { defaultPhoneGpuModel } from "./mobile-models.ts";

export type RuntimePreference = { modelId: string; cpuExplicitChoice: boolean };
export function selectedRuntimePreference(modelId: string): RuntimePreference {
  const model = getChatModel(modelId); if (!model) throw Error("unsupported_model");
  return { modelId: model.id, cpuExplicitChoice: model.backend === "cpu" };
}

// Old settings did not record an explicit CPU choice. Desktop/laptop startup
// returns those selections to GPU; choosing CPU in the app opts in explicitly.
// Legacy phone CPU selections remain valid for devices without usable WebGPU.
export function restoreRuntimePreference(input: unknown, mobile: boolean): RuntimePreference {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = getChatModel(data.modelId);
  if (model && (model.backend === "webgpu" || data.cpuExplicitChoice === true || mobile)) return selectedRuntimePreference(model.id);
  return { modelId: mobile ? defaultPhoneGpuModel : defaultConversationModel, cpuExplicitChoice: false };
}

export function runtimeLabel(modelId: unknown): "GPU · WebGPU" | "CPU · WebAssembly" | "" {
  const model = getChatModel(modelId);
  return model ? model.backend === "cpu" ? "CPU · WebAssembly" : "GPU · WebGPU" : "";
}
