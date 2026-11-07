"use client";
// Copyright © 2026 Alen Pepa
import { useRef } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { responseRefinement, responseRefinements } from "../lib/response-refinements";
import type { Locale } from "../lib/templates";
export default function ResponseRefine({ locale, disabled, onApply }: { locale: Locale; disabled: boolean; onApply: (prompt: string) => void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  return <details className="response-refine" ref={panel}><summary><Sparkles size={12}/>{locale === "de" ? "Verfeinern" : "Refine"}<ChevronDown size={10}/></summary><div role="group" aria-label={locale === "de" ? "Antwort in neuem Zweig verfeinern" : "Refine response in a new branch"}><small>{locale === "de" ? "Öffnet einen neuen Gesprächszweig." : "Opens a new conversation branch."}</small>{responseRefinements.map(action => { const item = responseRefinement(action, locale); return <button key={action} disabled={disabled} onClick={() => { if (panel.current) panel.current.open = false; onApply(item.prompt); }}>{item.label}</button>; })}</div></details>;
}
