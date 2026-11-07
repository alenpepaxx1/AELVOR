// Copyright © 2026 Alen Pepa
import { gpuVendor, type GpuVendor } from "./gpu-identity.ts";

export const hardwareReportLimit = 128_000;
export const hardwareReportKey = "aelvor-hardware-report-v1";
export type HardwareCpu = { name: string; manufacturer: string; cores: number | null; logicalProcessors: number | null };
export type HardwareGpu = { id: string; name: string; vendor: GpuVendor; dedicatedBytes: number | null; sharedBytes: number | null; software: boolean | null; source: "dxgi" | "cim" };
export type HardwareReport = { format: "aelvor-hardware"; version: 1; os: "windows"; generatedAt: string; cpus: HardwareCpu[]; ram: { installedBytes: number | null; visibleBytes: number | null; availableBytes: number | null }; gpus: HardwareGpu[]; warnings: string[] };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("hardware_report_invalid");
  return value as Record<string, unknown>;
};
const label = (value: unknown, maximum = 256) => {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw Error("hardware_report_invalid");
  return value.trim();
};
const integer = (value: unknown, maximum: number): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw Error("hardware_report_invalid");
  return value;
};
const bytes = (value: unknown) => integer(value, 2 ** 50);
const warnings = new Set(["cpu-unavailable", "ram-installed-unavailable", "ram-visible-unavailable", "gpu-dxgi-unavailable", "gpu-dxgi-64bit-required", "gpu-cim-unavailable", "gpu-list-truncated"]);
export function parseHardwareReport(text: string): HardwareReport {
  if (text.length > hardwareReportLimit) throw Error("hardware_report_large");
  let raw: Record<string, unknown>;
  try { raw = object(JSON.parse(text.replace(/^\uFEFF/, ""))); } catch { throw Error("hardware_report_invalid"); }
  if (raw.format !== "aelvor-hardware" || raw.version !== 1 || raw.os !== "windows") throw Error("hardware_report_format");
  if (typeof raw.generatedAt !== "string" || raw.generatedAt.length > 40 || !Number.isFinite(Date.parse(raw.generatedAt))) throw Error("hardware_report_invalid");
  if (!Array.isArray(raw.cpus) || raw.cpus.length > 64 || !Array.isArray(raw.gpus) || raw.gpus.length > 64 || !Array.isArray(raw.warnings) || raw.warnings.length > 16) throw Error("hardware_report_invalid");
  const cpus = raw.cpus.map(value => { const row = object(value); return { name: label(row.name), manufacturer: label(row.manufacturer), cores: integer(row.cores, 8192), logicalProcessors: integer(row.logicalProcessors, 16384) }; });
  const ids = new Set<string>();
  const gpus = raw.gpus.map(value => {
    const row = object(value), id = label(row.id, 40), name = label(row.name);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || !["dxgi", "cim"].includes(String(row.source)) || row.software !== null && typeof row.software !== "boolean") throw Error("hardware_report_invalid");
    if (row.source === "cim" && (row.dedicatedBytes !== null || row.sharedBytes !== null)) throw Error("hardware_report_invalid");
    ids.add(id);
    const claimedVendor = row.vendor;
    const vendor: GpuVendor = typeof claimedVendor === "string" && ["nvidia", "amd", "intel", "apple", "qualcomm", "arm", "samsung", "unknown"].includes(claimedVendor) ? claimedVendor as GpuVendor : gpuVendor(name);
    return { id, name, vendor, dedicatedBytes: bytes(row.dedicatedBytes), sharedBytes: bytes(row.sharedBytes), software: row.software as boolean | null, source: row.source as "dxgi" | "cim" };
  });
  const memory = object(raw.ram), ram = { installedBytes: bytes(memory.installedBytes), visibleBytes: bytes(memory.visibleBytes), availableBytes: bytes(memory.availableBytes) };
  if (ram.availableBytes !== null && ram.visibleBytes !== null && ram.availableBytes > ram.visibleBytes) throw Error("hardware_report_invalid");
  return { format: "aelvor-hardware", version: 1, os: "windows", generatedAt: new Date(raw.generatedAt).toISOString(), cpus, gpus, ram, warnings: [...new Set(raw.warnings.map(value => { if (typeof value !== "string" || !warnings.has(value)) throw Error("hardware_report_invalid"); return value; }))] };
}

export type HardwareStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class HardwareReportStore {
  private current: { report: HardwareReport; persisted: boolean } | null = null;
  private ignoreStored = false;
  private storage: () => HardwareStorage;
  constructor(storage: () => HardwareStorage = () => globalThis.localStorage) { this.storage = storage; }
  read() {
    if (this.current || this.ignoreStored) return this.current;
    try { const raw = this.storage().getItem(hardwareReportKey); if (raw) this.current = { report: parseHardwareReport(raw), persisted: true }; } catch { /* An unreadable local report never breaks hardware checks. */ }
    return this.current;
  }
  save(report: HardwareReport) {
    const clean = parseHardwareReport(JSON.stringify(report)); let persisted = false;
    try { this.storage().setItem(hardwareReportKey, JSON.stringify(clean)); persisted = true; } catch { /* Keep the imported report for this visit. */ }
    this.ignoreStored = false;
    return this.current = { report: clean, persisted };
  }
  clear(): boolean {
    this.current = null; this.ignoreStored = true;
    try { this.storage().removeItem(hardwareReportKey); return true; } catch { return false; }
  }
}
export class HardwareReportImport {
  private epoch = 0;
  private closed = false;
  private store: HardwareReportStore;
  constructor(store: HardwareReportStore) { this.store = store; }
  cancel() { this.epoch++; }
  close() { this.closed = true; this.cancel(); }
  async read(file: { size: number; text: () => Promise<string> }) {
    const epoch = ++this.epoch;
    if (this.closed) return null;
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > hardwareReportLimit) throw Error("hardware_report_large");
    try {
      const text = await file.text();
      if (this.closed || epoch !== this.epoch) return null;
      return this.store.save(parseHardwareReport(text));
    } catch (error) { if (this.closed || epoch !== this.epoch) return null; throw error; }
  }
}
export const sessionHardwareReport = new HardwareReportStore();
