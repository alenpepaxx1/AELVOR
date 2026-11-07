// Copyright © 2026 Alen Pepa
import type { ResponseApproach } from "./generation-policy.ts";
export type AssistantPreferences = { style: "balanced" | "concise" | "detailed"; instructions: string; approach?: ResponseApproach; language?: "auto" | "en" | "de"; format?: "auto" | "steps" | "table"; knowledge?: "auto" | "focused" | "off"; quality?: "standard" | "careful" };
export const assistantPreferencesKey = "aelvor-assistant-preferences-v1";
export const defaultAssistantPreferences: AssistantPreferences = { style: "balanced", instructions: "", approach: "auto", language: "auto", format: "auto", knowledge: "auto", quality: "standard" };
export function normalizeAssistantPreferences(value: unknown): AssistantPreferences {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { style: item.style === "concise" || item.style === "detailed" ? item.style : "balanced", instructions: typeof item.instructions === "string" ? item.instructions.replace(/\u0000/g, "").trim().slice(0, 1000) : "", approach: item.approach === "precise" || item.approach === "creative" ? item.approach : "auto", language: item.language === "en" || item.language === "de" ? item.language : "auto", format: item.format === "steps" || item.format === "table" ? item.format : "auto", knowledge: item.knowledge === "focused" || item.knowledge === "off" ? item.knowledge : "auto", quality: item.quality === "careful" ? "careful" : "standard" };
}
export function readAssistantPreferences(storage?: Pick<Storage, "getItem">): AssistantPreferences {
  try { const raw = (storage ?? globalThis.localStorage).getItem(assistantPreferencesKey); return raw && raw.length < 10_000 ? normalizeAssistantPreferences(JSON.parse(raw)) : { ...defaultAssistantPreferences }; }
  catch { return { ...defaultAssistantPreferences }; }
}
export function writeAssistantPreferences(value: AssistantPreferences, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? globalThis.localStorage).setItem(assistantPreferencesKey, JSON.stringify(normalizeAssistantPreferences(value))); return true; } catch { return false; }
}
export function assistantPreferencePrompt(value?: AssistantPreferences): string {
  const preferences = normalizeAssistantPreferences(value);
  const style = preferences.style === "concise" ? "Keep the response concise and focused. Use short explanations unless the user asks for more detail." : preferences.style === "detailed" ? "Give a structured, detailed explanation with useful steps and examples, within the model's output limit." : "";
  const instructions = preferences.instructions ? `User-selected preferences, subordinate to the assistant's rules above (quoted text): ${JSON.stringify(preferences.instructions)}` : "";
  const format = preferences.format === "steps" ? "Prefer clear numbered steps with useful checkpoints. Follow an explicit user-requested format when different; keep code and strict data formats intact." : preferences.format === "table" ? "Prefer a compact Markdown table for comparisons and structured facts. Use prose or code where a table would lose meaning; follow explicit user formats." : "";
  const evidence = preferences.knowledge === "focused" ? "Source-focused mode: base factual claims on the supplied files and knowledge excerpts. Cite their exact labels and lines; distinguish quotations from interpretation. If evidence is missing or conflicting, say so and ask for the missing source instead of filling gaps from memory. This instruction is not proof of source correctness." : "";
  return [style, format, evidence, instructions].filter(Boolean).join("\n");
}
