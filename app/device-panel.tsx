"use client";
// Copyright © 2026 Alen Pepa
import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Gauge, HardDrive, Loader2, MemoryStick, RefreshCw } from "lucide-react";
import { inspectDevice, normalizeDeviceBudget, runtimeBufferLimits, type DeviceBudget, type DeviceCapabilities, type CompatibilityIssue, type CompatibilityReport } from "../lib/device-capabilities";
import type { Locale } from "../lib/templates";
import HardwareReportPanel from "./hardware-report-panel";

export function useDeviceInspection() {
  const [device, setDevice] = useState<DeviceCapabilities | null>(null);
  const [checking, setChecking] = useState(true);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    setChecking(true);
    try { const value = await inspectDevice(); if (epoch.current === current) setDevice(value); }
    finally { if (epoch.current === current) setChecking(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { epoch.current++; }; }, [refresh]);
  return { device, checking, refresh };
}

export function compatibilityText(issue: CompatibilityIssue, locale: Locale, report: CompatibilityReport): string {
  const de = locale === "de";
  const messages: Record<CompatibilityIssue, [string, string]> = {
    "gpu-budget-device": ["This VRAM budget belongs to a different or unconfirmed WebGPU adapter. Recheck the GPU and apply its matching report, or explicitly enter a new manual budget.", "Dieses VRAM-Budget gehört zu einem anderen oder unbestätigten WebGPU-Adapter. Prüfe die GPU und übernimm ihren passenden Bericht oder trage ausdrücklich ein neues manuelles Budget ein."],
    "gpu-selection": ["The required GPU manufacturer is not exposed by this browser. Set the browser or app to your dedicated GPU in Windows Graphics settings, restart it and check again.", "Der erforderliche GPU-Hersteller wird von diesem Browser nicht bereitgestellt. Weise dem Browser oder der App in den Windows-Grafikeinstellungen die dedizierte GPU zu, starte neu und prüfe erneut."],
    "software-gpu": ["The browser reports a software WebGPU adapter. Enable hardware acceleration or choose CPU mode explicitly.", "Der Browser meldet einen Software-WebGPU-Adapter. Aktiviere Hardwarebeschleunigung oder wähle ausdrücklich den CPU-Modus."],
    webgpu: ["WebGPU is unavailable. GPU mode needs a compatible browser and GPU. Choose CPU compatibility to run without WebGPU.", "WebGPU ist nicht verfügbar. Der GPU-Modus benötigt einen kompatiblen Browser und eine GPU. Wähle CPU-Kompatibilität, um ohne WebGPU zu arbeiten."],
    probe: ["GPU features or required buffer limits could not be checked. Refresh the device check.", "GPU-Funktionen oder benötigte Pufferlimits konnten nicht geprüft werden. Aktualisiere die Geräteprüfung."],
    worker: ["This browser cannot start background workers.", "Dieser Browser kann keine Hintergrund-Worker starten."],
    features: [`Required GPU features missing: ${report.missingFeatures.join(", ")}. Try an FP32 variant.`, `Benötigte GPU-Funktionen fehlen: ${report.missingFeatures.join(", ")}. Versuche eine FP32-Variante.`],
    buffer: ["A required GPU buffer exceeds this browser's limit. This limit is not total VRAM.", "Ein benötigter GPU-Puffer überschreitet das Browserlimit. Dieses Limit ist nicht der gesamte GPU-Speicher."],
    "runtime-limits": ["This GPU does not meet the runtime's minimum GPU limits: 256 MiB buffers, 128 MiB storage bindings, 32 KiB workgroup storage and 10 storage buffers per shader stage. A smaller model cannot fix this.", "Diese GPU erfüllt die Mindestlimits der Runtime nicht: 256 MiB Puffer, 128 MiB Storage-Bindings, 32 KiB Workgroup-Speicher und 10 Storage-Puffer pro Shader-Stufe. Ein kleineres Modell behebt das nicht."],
    "gpu-budget": [`GPU planning estimate ${report.gpuPlanningGB} GB exceeds your budget.`, `Die GPU-Planungsschätzung von ${report.gpuPlanningGB} GB überschreitet dein Budget.`],
    "ram-budget": [`RAM planning estimate ${report.ramPlanningGB} GB exceeds your budget.`, `Die RAM-Planungsschätzung von ${report.ramPlanningGB} GB überschreitet dein Budget.`],
    "gpu-unknown": ["Larger models require a known GPU memory budget. Set it in the memory budgets above or choose a smaller model.", "Größere Modelle benötigen ein bekanntes GPU-Speicherbudget. Trage es oben unter Speicherbudgets ein oder wähle ein kleineres Modell."],
    "ram-unknown": ["RAM is not reported. Enter your known RAM budget for this model.", "RAM wird nicht gemeldet. Trage für dieses Modell dein bekanntes RAM-Budget ein."],
    "ram-estimate": ["The browser RAM estimate is below the planning requirement. It can be capped; enter a known budget or choose a smaller model.", "Die RAM-Schätzung des Browsers liegt unter dem Planungsbedarf. Sie kann begrenzt sein; trage ein bekanntes Budget ein oder wähle ein kleineres Modell."],
    "memory-unknown": ["Available RAM and VRAM cannot be measured reliably here. Memory fit is preliminary; loading can still fail.", "Freier RAM und GPU-Speicher lassen sich hier nicht zuverlässig messen. Die Speichereinschätzung ist vorläufig; das Laden kann weiterhin fehlschlagen."],
    cpu: ["CPU thread count is low or hidden. It does not measure processor speed; loading may be slower.", "Die CPU-Thread-Anzahl ist niedrig oder unbekannt. Sie misst nicht die Prozessorleistung; das Laden kann langsamer sein."],
    "mobile-memory": ["This model exceeds the phone memory profile. Choose a phone preset; a large physical RAM budget cannot remove browser limits.", "Dieses Modell überschreitet das Smartphone-Speicherprofil. Wähle ein Smartphone-Profil; ein großes physisches RAM-Budget hebt Browserlimits nicht auf."],
    storage: ["The download estimate exceeds the remaining browser cache quota. Cached files may already reduce the download.", "Die Download-Schätzung übersteigt das verbleibende Browser-Kontingent. Bereits gespeicherte Dateien können den Download verkleinern."],
  };
  return messages[issue][de ? 1 : 0];
}

export default function DevicePanel({ locale, device, checking, refresh, budget, onBudgetChange, disabled, backend = "webgpu" }: { backend?: "cpu" | "webgpu"; locale: Locale; device: DeviceCapabilities | null; checking: boolean; refresh: () => void; budget: DeviceBudget; onBudgetChange: (value: DeviceBudget) => void; disabled: boolean }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const runtimeLimits = device ? runtimeBufferLimits(device) : null;
  const ramOptions = [...new Set([2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, ...(budget.ramGB ? [budget.ramGB] : [])])].sort((a, b) => a - b);
  const gpuOptions = [...new Set([0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 80, 96, 128, 192, 256, ...(budget.gpuGB ? [budget.gpuGB] : [])])].sort((a, b) => a - b);
  return <section className="device-panel" aria-labelledby="device-panel-title">
    <div className="device-panel-heading"><h3 id="device-panel-title"><Gauge size={15}/>{t("Your device", "Dein Gerät")}</h3><button disabled={checking || disabled} onClick={refresh}>{checking ? <Loader2 size={12} className="spin"/> : <RefreshCw size={12}/>} {checking ? t("Checking…", "Wird geprüft…") : t("Check again", "Erneut prüfen")}</button></div>
    <div className="device-cards" aria-live="polite">
      <div><Cpu size={17}/><span>CPU · Browser</span><strong>{device?.cpuThreads ? `${device.cpuThreads} ${t("threads", "Threads")}` : t("Not reported", "Nicht gemeldet")}</strong><small>{t("Browser logical processors · CPU model not exposed", "Logische Browser-Prozessoren · CPU-Modell nicht bereitgestellt")}</small></div>
      <div><MemoryStick size={17}/><span>RAM</span><strong>{device?.ramEstimateGB ? `≈ ${device.ramEstimateGB} GB` : t("Not reported", "Nicht gemeldet")}</strong><small>{t("Browser estimate · May be capped", "Browser-Schätzung · Kann begrenzt sein")}</small></div>
      <div><HardDrive size={17}/><span>GPU</span><strong>{device?.gpu === "available" ? device.softwareGpu ? "Software WebGPU" : `${device.gpuVendor && device.gpuVendor !== "unknown" ? device.gpuVendor.toUpperCase() + " · " : ""}WebGPU` : checking ? t("Checking", "Wird geprüft") : t("Unavailable", "Nicht verfügbar")}</strong><small>{device?.gpuName || t("VRAM capacity is not exposed", "GPU-Speichergröße wird nicht gemeldet")}</small></div>
      <div><MemoryStick size={17}/><span>VRAM · Browser</span><strong>{t("Not exposed", "Nicht bereitgestellt")}</strong><small>{t("GPU buffer limits are not VRAM capacity", "GPU-Pufferlimits sind keine VRAM-Kapazität")}</small></div>
    </div>
    <div className="device-cpu-runtime"><Cpu size={13}/><span>{device?.cpu?.wasm && device.cpu.simd ? `CPU · WebAssembly SIMD · ${device.cpu.threads} ${t("inference threads", "Inferenzthreads")}` : t("CPU inference needs WebAssembly SIMD", "CPU-Inferenz benötigt WebAssembly SIMD")}</span></div>
    <details className="device-budget-details"><summary>{t("Memory budgets and technical limits", "Speicherbudgets und technische Limits")}</summary>
      <p>{t("Optional: enter budgets from your device specifications. Larger models require them when browser estimates are missing or too small. Leave unknown values unset. Budgets apply to the next load.", "Optional: Trage Budgets anhand deiner Gerätespezifikationen ein. Größere Modelle benötigen sie, wenn Browser-Schätzungen fehlen oder zu klein sind. Lasse unbekannte Werte leer. Budgets gelten beim nächsten Laden.")}</p>
      <div className="device-budget-fields"><label>{t("RAM budget", "RAM-Budget")}<select disabled={disabled} value={budget.ramGB ?? ""} onChange={event => onBudgetChange(normalizeDeviceBudget({ ...budget, ramGB: event.target.value ? Number(event.target.value) : undefined }))}><option value="">{t("Use browser estimate", "Browser-Schätzung nutzen")}</option>{ramOptions.map(value => <option key={value} value={value}>{value} GB</option>)}</select></label>{backend !== "cpu" && <label>{t("GPU memory budget", "GPU-Speicherbudget")}<select disabled={disabled} value={budget.gpuGB ?? ""} onChange={event => onBudgetChange(normalizeDeviceBudget({ ...budget, gpuGB: event.target.value ? Number(event.target.value) : undefined, gpuBinding: undefined }))}><option value="">{t("Unknown", "Unbekannt")}</option>{gpuOptions.map(value => <option key={value} value={value}>{value} GB</option>)}</select></label>}</div>
      {budget.gpuBinding && <p>{t("VRAM budget linked to", "VRAM-Budget verknüpft mit")}: <strong>{budget.gpuBinding}</strong></p>}
      <p>{t("For integrated GPUs, GPU memory shares system RAM. Leave room for the operating system, browser and other apps. A GPU buffer limit is a single-allocation constraint, not total or free VRAM.", "Integrierte GPUs teilen sich den Arbeitsspeicher. Lasse Platz für Betriebssystem, Browser und andere Apps. Ein GPU-Pufferlimit begrenzt einzelne Belegungen und ist kein gesamter oder freier GPU-Speicher.")}</p>
      <dl><div><dt>{t("Storage buffer limit", "Storage-Pufferlimit")}</dt><dd>{device?.maxStorageBufferBytes ? `${Math.round(device.maxStorageBufferBytes / 1048576)} MiB` : "—"}</dd></div><div><dt>{t("Runtime storage buffer limit", "Storage-Pufferlimit der Runtime")}</dt><dd>{runtimeLimits?.maxStorageBufferBytes ? `${Math.round(runtimeLimits.maxStorageBufferBytes / 1048576)} MiB` : "—"}</dd></div><div><dt>{t("FP16 support", "FP16-Unterstützung")}</dt><dd>{device?.gpu === "available" ? device.features.includes("shader-f16") ? t("Available", "Verfügbar") : t("Not available", "Nicht verfügbar") : "—"}</dd></div><div><dt>{t("Remaining browser cache quota", "Verbleibendes Browser-Kontingent")}</dt><dd>{device?.cacheAvailableGB !== null && device?.cacheAvailableGB !== undefined ? `${device.cacheAvailableGB.toFixed(1)} GB` : "—"}</dd></div></dl>
    </details>
    <HardwareReportPanel device={device} budget={budget} onBudgetChange={onBudgetChange} disabled={disabled || checking} backend={backend} locale={locale}/>
  </section>;
}
