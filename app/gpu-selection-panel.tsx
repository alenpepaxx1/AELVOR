"use client";
// Copyright © 2026 Alen Pepa
import { Cpu, RefreshCw } from "lucide-react";
import { gpuSelectionIssue, normalizeGpuPreference, type GpuPreference, type RuntimeGpuInfo } from "../lib/gpu-selection";
import type { DeviceCapabilities } from "../lib/device-capabilities";
import type { Locale } from "../lib/templates";
import { diagnoseGpu } from "../lib/gpu-diagnostics";
import GpuActivationGuide from "./gpu-activation-guide";

export default function GpuSelectionPanel({ preference = "auto", onChange, device, checking, disabled, refresh, loadedGpu, runtimeError, gpuBinding, locale }: { preference?: GpuPreference; onChange?: (value: GpuPreference) => void; device: DeviceCapabilities | null; checking: boolean; disabled: boolean; refresh: () => void; loadedGpu?: RuntimeGpuInfo; runtimeError?: string; gpuBinding?: string; locale: Locale }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const issue = gpuSelectionIssue(device || undefined, preference);
  const vendor = preference.toUpperCase();
  const diagnostic = diagnoseGpu({ device, checking, preference, loadedGpu, runtimeError, gpuBinding });
  return <section className="gpu-selection-panel" aria-labelledby="gpu-selection-title"><div className="gpu-selection-heading"><Cpu size={18}/><div><h3 id="gpu-selection-title">{t("Choose the GPU for local AI", "GPU für lokale AI wählen")}</h3><p>{t("AELVOR requests high-performance WebGPU. A required manufacturer blocks loading if that GPU cannot be confirmed.", "AELVOR fordert leistungsstarkes WebGPU an. Ein erforderlicher Hersteller blockiert das Laden, wenn diese GPU nicht bestätigt wird.")}</p></div></div>
    <label htmlFor="gpu-vendor-preference">{t("GPU selection", "GPU-Auswahl")}</label><select id="gpu-vendor-preference" disabled={disabled || !onChange} value={preference} onChange={event => { onChange?.(normalizeGpuPreference(event.target.value)); refresh(); }}><option value="auto">{t("Automatic · High performance", "Automatisch · Hohe Leistung")}</option><option value="nvidia">{t("NVIDIA required · RTX / GTX", "NVIDIA erforderlich · RTX / GTX")}</option><option value="amd">{t("AMD required · Radeon", "AMD erforderlich · Radeon")}</option><option value="intel">{t("Intel required · Arc / integrated", "Intel erforderlich · Arc / integriert")}</option></select>
    <p className="gpu-selection-explanation">{t("These are requirements, not a list of installed cards. The browser and operating system choose the adapter; a website cannot expose a hidden GPU or select a specific RTX card by name.", "Dies sind Anforderungen, keine Liste installierter Karten. Browser und Betriebssystem wählen den Adapter; eine Website kann keine verborgene GPU freigeben oder eine bestimmte RTX-Karte nach Namen auswählen.")}</p>
    <dl className="gpu-selection-facts"><div><dt>{t("Browser GPU check", "GPU-Prüfung des Browsers")}</dt><dd>{checking ? t("Checking…", "Wird geprüft…") : device?.gpu === "available" ? device.gpuName || (device.gpuVendor && device.gpuVendor !== "unknown" ? device.gpuVendor.toUpperCase() : t("Name not reported", "Name nicht gemeldet")) : t("Unavailable or not confirmed", "Nicht verfügbar oder unbestätigt")}</dd></div>{loadedGpu && <div><dt>{t("Loaded model GPU", "GPU des geladenen Modells")}</dt><dd>{loadedGpu.name || t("Name not reported", "Name nicht gemeldet")}</dd></div>}</dl>
    {!checking && issue && <p className="gpu-selection-status blocked" role="status">{issue === "unknown" ? t(`${vendor} is required, but the GPU manufacturer is hidden or unavailable. Loading stays blocked until it can be confirmed, or you explicitly choose Automatic.`, `${vendor} ist erforderlich, aber der GPU-Hersteller ist verborgen oder nicht verfügbar. Das Laden bleibt blockiert, bis er bestätigt wird oder du ausdrücklich Automatisch wählst.`) : t(`${vendor} is required. The browser currently exposes another manufacturer. Follow the GPU steps below, restart the browser and check again.`, `${vendor} ist erforderlich. Der Browser stellt derzeit einen anderen Hersteller bereit. Folge den GPU-Schritten unten, starte den Browser neu und prüfe erneut.`)}</p>}
    <GpuActivationGuide diagnostic={diagnostic} device={device} preference={preference} locale={locale}/>
    <button type="button" className="secondary-button" disabled={checking || disabled} onClick={refresh}><RefreshCw size={13}/>{t("Check GPU again", "GPU erneut prüfen")}</button>
  </section>;
}
