// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HardwareReportStore, HardwareReportImport, hardwareReportKey, hardwareReportLimit, parseHardwareReport } from "../lib/hardware-report.ts";
import { matchingReportGpu, reportMemoryBudget } from "../lib/hardware-budget.ts";
import { normalizeDeviceBudget, assessModel, inspectDevice } from "../lib/device-capabilities.ts";
import { withModelResources } from "../lib/model-load-gate.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { readConversationSettings, writeConversationSettings, normalizeConversationSettings } from "../lib/conversation-settings.ts";
import { gpuRuntimeFixture } from "./support/gpu-runtime-fixture.mjs";
import { hardwareFixture, hardwareBrowser, GiB } from "./support/hardware-fixtures.mjs";

const memoryStore = () => { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; };
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve }; };

test("OS reports retain complete CPU/GPU identities and memory above 4 GiB without adding shared memory", () => {
  const input = hardwareFixture(), report = parseHardwareReport(JSON.stringify(input));
  assert.deepEqual(report.cpus.map(cpu => cpu.name), input.cpus.map(cpu => cpu.name));
  assert.equal(report.ram.installedBytes, 64 * GiB); assert.equal(report.ram.availableBytes, 32 * GiB);
  assert.equal(report.gpus[0].dedicatedBytes, 24 * GiB); assert.equal(report.gpus[0].sharedBytes, 32 * GiB);
  assert.equal(report.gpus[3].dedicatedBytes, null); assert.equal(report.gpus[3].software, null);
  assert.equal(report.generatedAt, "2026-10-31T20:00:00.123Z");
  const plan = reportMemoryBudget(report, hardwareBrowser(), true, true);
  assert.equal(plan.ramGB, Math.floor(32 * GiB / 1e8) / 10);
  assert.equal(plan.gpuGB, Math.floor(24 * GiB / 1e8) / 10);
  assert.equal(plan.gpuBinding, report.gpus[0].name);
});

test("invalid, oversized and inconsistent reports cannot become hardware facts", () => {
  assert.throws(() => parseHardwareReport(" ".repeat(hardwareReportLimit + 1)), /hardware_report_large/);
  for (const change of [r => r.version = 2, r => r.os = "unknown", r => r.cpus[0].cores = -1, r => r.gpus[0].dedicatedBytes = Number.MAX_SAFE_INTEGER, r => r.gpus[1].id = r.gpus[0].id, r => r.ram.availableBytes = r.ram.visibleBytes + 1, r => r.gpus[3].dedicatedBytes = 4 * GiB, r => r.cpus[0].name = "CPU\u0000forged", r => r.gpus = Array.from({ length: 65 }, () => ({}))]) {
    const input = hardwareFixture(); change(input);
    assert.throws(() => parseHardwareReport(JSON.stringify(input)), /hardware_report_/);
  }
  for (const text of ["{", "null", "[]"]) assert.throws(() => parseHardwareReport(text), /hardware_report_invalid/);
});

test("unknown values stay unknown and extra personal or device-unique fields are discarded", () => {
  const input = hardwareFixture(); input.hostname = "private-host"; input.user = "private-user";
  input.cpus[0].serialNumber = "private-serial"; input.gpus[0].deviceUniqueId = "private-device";
  input.ram.installedBytes = null; input.ram.availableBytes = null;
  const report = parseHardwareReport(JSON.stringify(input)), saved = JSON.stringify(report);
  assert.doesNotMatch(saved, /private-host|private-user|private-serial|private-device/);
  assert.equal(report.ram.installedBytes, null);
  assert.equal(reportMemoryBudget(report, hardwareBrowser(), true, false).ramGB, Math.floor(report.ram.visibleBytes / 1e8) / 10);
});

test("VRAM matching rejects another GPU, vendor-only labels, duplicate cards and software adapters", () => {
  const report = parseHardwareReport(JSON.stringify(hardwareFixture()));
  assert.equal(matchingReportGpu(report, hardwareBrowser()).id, "gpu-0");
  assert.equal(matchingReportGpu(report, hardwareBrowser("NVIDIA")), null);
  assert.equal(matchingReportGpu(report, hardwareBrowser("NVIDIA ampere")), null);
  assert.equal(matchingReportGpu(report, hardwareBrowser("Intel Iris Xe")), null);
  assert.equal(matchingReportGpu(report, { ...hardwareBrowser(), softwareGpu: true }), null);
  const duplicate = { ...report, gpus: [...report.gpus, { ...report.gpus[0], id: "second-4090", dedicatedBytes: 48 * GiB }] };
  assert.equal(matchingReportGpu(duplicate, hardwareBrowser()), null);
  const integrated = reportMemoryBudget(report, hardwareBrowser("Intel UHD Graphics 770"), true, true);
  assert.equal(integrated.gpuGB, undefined); // Shared 32 GiB is not dedicated VRAM.
});

test("a Windows report cannot change phone or another operating system's planning budgets", () => {
  const report = hardwareFixture();
  for (const device of [{ ...hardwareBrowser(), os: "linux" }, { ...hardwareBrowser(), os: "unknown" }, { ...hardwareBrowser(), os: "windows", mobile: { mobile: true } }]) assert.throws(() => reportMemoryBudget(report, device, true, true), /hardware_report_device/);
  assert.throws(() => reportMemoryBudget(report, hardwareBrowser(), false, true), /hardware_report_device/);
});

test("an imported RTX VRAM budget fails the live gate on Intel, including after a settings reload", async () => {
  const budget = reportMemoryBudget(hardwareFixture(), hardwareBrowser(), true, true);
  const saved = memoryStore(); writeConversationSettings(normalizeConversationSettings({ hardwareBudget: budget }), saved);
  assert.deepEqual(readConversationSettings(saved).hardwareBudget, budget);
  const intel = hardwareBrowser("Intel UHD Graphics 770"), model = getConversationModel(defaultConversationModel);
  assert.ok(assessModel(model, intel, budget).blockers.includes("gpu-budget-device"));
  let started = false;
  await assert.rejects(withModelResources(model, { budget, inspect: async () => intel, signal: new AbortController().signal }, async () => { started = true; }), /gpu-budget-device/);
  assert.equal(started, false);
  const manual = normalizeDeviceBudget({ ...budget, gpuBinding: undefined });
  assert.ok(!assessModel(model, intel, manual).blockers.includes("gpu-budget-device"));
});

test("a worker that changes from the matched RTX to Intel cannot pass readiness under Automatic GPU mode", async () => {
  const device = hardwareBrowser("NVIDIA RTX 4060"), budget = { ramGB: 32, gpuGB: 8, gpuBinding: device.gpuName };
  const fixture = await gpuRuntimeFixture({ device, reports: [{ progress: 1, text: "Finish loading on WebGPU - Intel Iris Xe" }] });
  try {
    await assert.rejects(fixture.load(defaultConversationModel, { budget, gpuPreference: "auto", signal: new AbortController().signal, onProgress() {}, onFatal() {} }), /gpu-budget-device/);
    assert.equal(fixture.state.warmReplies, 0); assert.equal(fixture.state.terminated, 1);
  } finally { fixture.cleanup(); }
});

test("imports persist only sanitized data and storage failure still keeps the snapshot for the visit", async () => {
  const storage = memoryStore(), store = new HardwareReportStore(() => storage);
  const saved = store.save(hardwareFixture()); assert.equal(saved.persisted, true);
  assert.equal(new HardwareReportStore(() => storage).read().report.gpus[0].dedicatedBytes, 24 * GiB);
  const denied = new HardwareReportStore(() => { throw Error("Denied"); });
  assert.equal(denied.save(hardwareFixture()).persisted, false); assert.equal(denied.read().report.ram.installedBytes, 64 * GiB);
  assert.equal(denied.clear(), false); assert.equal(denied.read(), null);
  const importer = new HardwareReportImport(store); let reads = 0;
  await assert.rejects(importer.read({ size: hardwareReportLimit + 1, text: async () => { reads++; return "{}"; } }), /hardware_report_large/);
  assert.equal(reads, 0); importer.close();
});

test("clearing a report or closing its panel invalidates a pending file read before it can save", async () => {
  for (const close of [false, true]) {
    const storage = memoryStore(), store = new HardwareReportStore(() => storage), importer = new HardwareReportImport(store), pending = deferred();
    const result = importer.read({ size: 1000, text: () => pending.promise });
    if (close) importer.close(); else { importer.cancel(); store.clear(); }
    pending.resolve(JSON.stringify(hardwareFixture()));
    assert.equal(await result, null); assert.equal(storage.entries.has(hardwareReportKey), false);
  }
});

test("a newer import wins over an older asynchronous read and deletion failures remain distinguishable", async () => {
  const storage = memoryStore(), store = new HardwareReportStore(() => storage), importer = new HardwareReportImport(store), old = deferred();
  const pending = importer.read({ size: 1000, text: () => old.promise });
  const next = hardwareFixture(); next.cpus[0].name = "Newest CPU";
  await importer.read({ size: 1000, text: async () => JSON.stringify(next) });
  old.resolve(JSON.stringify(hardwareFixture())); assert.equal(await pending, null);
  assert.equal(store.read().report.cpus[0].name, "Newest CPU");
  const blockedDelete = new HardwareReportStore(() => ({ ...storage, removeItem() { throw Error("Denied"); } }));
  assert.ok(blockedDelete.read()); assert.equal(blockedDelete.clear(), false); assert.equal(blockedDelete.read(), null);
  assert.ok(new HardwareReportStore(() => storage).read()); importer.close();
});

test("browser inspection keeps a full reported GPU name but never invents CPU model, RAM total or VRAM", async () => {
  const name = "NVIDIA RTX 6000 Ada Generation " + "driver description ".repeat(5);
  const info = await inspectDevice({ userAgent: "Windows NT 10.0", hardwareConcurrency: 28, deviceMemory: 8, gpu: { requestAdapter: async () => ({ info: { description: name }, features: [], limits: {} }) } }, { workerAvailable: true });
  assert.equal(info.gpuName, name); assert.equal(info.os, "windows"); assert.equal(info.ramEstimateGB, 8);
  assert.equal(info.cpuModel, undefined); assert.equal(info.vramBytes, undefined); assert.equal(info.ramInstalledBytes, undefined);
});

test("the collector uses 64-bit DXGI and bounded read-only CIM queries with no legacy GPU-memory fallback", async () => {
  const script = await readFile(new URL("../public/hardware/aelvor-hardware.ps1", import.meta.url), "utf8");
  assert.match(script, /UIntPtr DedicatedVideoMemory/); assert.match(script, /DedicatedVideoMemory\.ToUInt64\(\)/);
  assert.match(script, /Is64BitProcess/); assert.match(script, /Marshal\.SizeOf\(typeof\(Desc1\)\) != 312/);
  assert.match(script, /Method<Enumerate>\(factory, 12\)/); assert.match(script, /Method<Describe>\(adapter, 10\)/);
  assert.match(script, /Win32_PhysicalMemory -Property Capacity/);
  assert.doesNotMatch(script, /Invoke-WebRequest|Invoke-RestMethod|Set-ExecutionPolicy|Start-Process|AdapterRAM|ProcessorId|SerialNumber|COMPUTERNAME|USERNAME/i);
  assert.match(script, /FileMode\]::CreateNew/); assert.match(script, /Copyright © 2026 Alen Pepa/);
});
