// Copyright © 2026 Alen Pepa
import type { Locale } from "./templates.ts";
export function responseLanguage(text: string, fallback: Locale): Locale {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, "");
  const words = prose.toLowerCase().match(/[\p{L}]+/gu) || [];
  const german = new Set("hallo guten danke ich du sie wir ist sind das der die ein eine und nicht für mit auf kann kannst werde werden bitte dir dein deine hier wenn auch zum zur diese einen einem heißt möchtest".split(" "));
  const english = new Set("hello thanks thank the this that you your are is and for with can will would here if how what about have not it explain write create compare calculate show give summarize translate debug answer please".split(" "));
  const de = words.filter(word => german.has(word)).length + (/[äöüß]/i.test(prose) ? 2 : 0), en = words.filter(word => english.has(word)).length;
  return de > en ? "de" : en > de ? "en" : fallback;
}
// Only the current user command can select the reply language, never files or
// a source excerpt. Explicit requests take precedence over a saved preference.
export function assistantReplyLocale(text: string, fallback: Locale, preference?: "auto" | Locale): Locale {
  const command = text.split("```")[0].split(/\r?\n/)[0].slice(0, 1000);
  const expression = /(?:^|\s)(?:answer|reply|respond|speak|explain|write|translate|antworte\w*|sprich|erkläre\w*|schreibe\w*|übersetz\w*)\b[^\n.!?]{0,100}?\b(?:in|into|to|auf|ins)\s+(english|german|deutsch(?:e|en)?|englisch(?:e|en)?)\b|^(?:please\s+|bitte\s+)?(?:in|auf)\s+(english|german|deutsch|englisch)\b/gi;
  let explicit: Locale | undefined;
  for (const match of command.matchAll(expression)) explicit = /german|deutsch/i.test(match[1] || match[2]) ? "de" : "en";
  return explicit || (preference === "en" || preference === "de" ? preference : responseLanguage(command, fallback));
}
