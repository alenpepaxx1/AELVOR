// Copyright © 2026 Alen Pepa
import { getConversationModel } from "./model-catalog.ts";
import { getCpuModel } from "./cpu-models.ts";

export function getChatModel(id: unknown) {
  const cpu = getCpuModel(id); if (cpu) return cpu;
  const gpu = getConversationModel(id); return gpu ? { ...gpu, backend: "webgpu" as const } : undefined;
}
