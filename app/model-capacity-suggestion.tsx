"use client";
// Copyright © 2026 Alen Pepa
import { Check, Sparkles } from "lucide-react";
import { gpuCapacitySuggestion } from "../lib/model-capacity";
import type { DeviceBudget, DeviceCapabilities } from "../lib/device-capabilities";
import type { Locale } from "../lib/templates";
import type { GpuPreference } from "../lib/gpu-selection";

export default function ModelCapacitySuggestion({ device, budget, selected, disabled, locale, onSelect, gpuPreference = "auto" }: { device: DeviceCapabilities | null; budget: DeviceBudget; selected: string; disabled: boolean; locale: Locale; onSelect: (id: string) => void; gpuPreference?: GpuPreference }) {
  const model = device ? gpuCapacitySuggestion(device, budget, gpuPreference) : null;
  if (!model) return null;
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const chosen = model.id === selected;
  return <section className="capacity-suggestion" aria-label={t("Model capacity suggestion", "Modell-Kapazitätsvorschlag")}><Sparkles size={19}/><div><small>{t("CAPACITY SUGGESTION", "KAPAZITÄTSVORSCHLAG")}</small><h3>{model.name}</h3><p>{t("A multilingual Qwen option within your current device checks and memory budgets. This shortlist favors larger parameter counts; answer quality and speed still vary.", "Eine mehrsprachige Qwen-Option innerhalb deiner Geräteprüfung und Speicherbudgets. Diese Vorauswahl bevorzugt mehr Parameter; Antwortqualität und Tempo variieren weiterhin.")}</p><span>{t("Select first, then download and load when ready.", "Erst auswählen, dann bei Bedarf herunterladen und laden.")}</span></div><button type="button" className="secondary-button" disabled={disabled || chosen} onClick={() => onSelect(model.id)}>{chosen ? <Check size={13}/> : <Sparkles size={13}/>} {chosen ? t("Selected", "Ausgewählt") : t("Select model", "Modell auswählen")}</button></section>;
}
