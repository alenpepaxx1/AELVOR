// Copyright © 2026 Alen Pepa
import { restoreRuntimePreference } from "./runtime-preference.ts";
import { normalizeDeviceBudget, type DeviceBudget } from "./device-capabilities.ts";
import { normalizeGpuPreference, type GpuPreference } from "./gpu-selection.ts";

export const conversationSettingsKey = "aegis-conversation-settings-v1";
export type ChatEngine = "chat" | "tools";
export type ConversationSettings = { engine: ChatEngine; modelId: string; cpuExplicitChoice: boolean; hardwareBudget: DeviceBudget; pausePhoneInBackground: boolean; gpuPreference: GpuPreference };
export function normalizeConversationSettings(input: unknown, mobile = false): ConversationSettings {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const selection = restoreRuntimePreference(data, mobile);
  return { ...selection, engine: data.engine === "tools" ? "tools" : "chat", hardwareBudget: normalizeDeviceBudget(data.hardwareBudget), pausePhoneInBackground: data.pausePhoneInBackground !== false, gpuPreference: normalizeGpuPreference(data.gpuPreference) };
}
export function readConversationSettings(storage?: Pick<Storage, "getItem">, mobile = false): ConversationSettings {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(conversationSettingsKey);
    return normalizeConversationSettings(raw && raw.length < 10000 ? JSON.parse(raw) : null, mobile);
  } catch { return normalizeConversationSettings(null, mobile); }
}
export function writeConversationSettings(value: ConversationSettings, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? globalThis.localStorage).setItem(conversationSettingsKey, JSON.stringify(normalizeConversationSettings(value))); return true; }
  catch { return false; }
}
