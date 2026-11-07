// Copyright © 2026 Alen Pepa
import type { Locale } from "./templates.ts";
export const responseRefinements = ["simpler", "shorter", "example", "german", "english"] as const;
export type ResponseRefinement = typeof responseRefinements[number];
export function responseRefinement(action: ResponseRefinement, locale: Locale) {
  const options: Record<ResponseRefinement, { en: [string, string]; de: [string, string] }> = {
    simpler: { en: ["Explain simply", "Make it simpler."], de: ["Einfach erklären", "Mach es einfacher."] },
    shorter: { en: ["Make shorter", "Make it shorter."], de: ["Kürzer fassen", "Mach es kürzer."] },
    example: { en: ["Give an example", "Give me an example."], de: ["Beispiel geben", "Gib mir ein Beispiel."] },
    german: { en: ["Translate to German", "Translate that into German."], de: ["Ins Deutsche übersetzen", "Übersetze das ins Deutsche."] },
    english: { en: ["Translate to English", "Translate that into English."], de: ["Ins Englische übersetzen", "Übersetze das ins Englische."] },
  };
  const [label, prompt] = options[action][locale]; return { label, prompt };
}
