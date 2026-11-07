// Copyright © 2026 Alen Pepa
import { normalizeGenerationSettings, type GenerationSettings } from "./generation-policy.ts";

export function cpuGenerationOptions(contextWindow: number, outputTokens: number, input?: GenerationSettings) {
  const settings = normalizeGenerationSettings(input);
  return { max_new_tokens: Math.min(outputTokens, settings.maxOutputTokens, Math.floor(contextWindow / 2)), do_sample: Boolean(input), temperature: settings.temperature, top_p: settings.topP, repetition_penalty: settings.repetitionPenalty, return_dict_in_generate: false };
}
