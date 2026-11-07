// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { mobileProfile, mobileExecutionLimits, mobileMemoryCeilings } from "../lib/mobile-device.ts";
import { connectMobileLifecycle, connectMobileViewport } from "../lib/mobile-lifecycle.ts";
import { phoneCpuRecommendation, phoneGpuRecommendation, defaultPhoneGpuModel } from "../lib/mobile-models.ts";
import { assessModel, gpuVendor, inspectDevice } from "../lib/device-capabilities.ts";
import { assessCpuModel, cpuModels, defaultPhoneCpuModel } from "../lib/cpu-models.ts";
import { getConversationModel } from "../lib/model-catalog.ts";
import { prepareConversation } from "../lib/conversation.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { cpuGenerationLimits, createCpuWorkerHandler } from "../lib/cpu-worker-protocol.ts";
import { CpuWorkerClient } from "../lib/cpu-worker-client.ts";
import { validateCpuFile } from "../lib/cpu-cache.ts";
import { withModelResources } from "../lib/model-load-gate.ts";

const iphone = mobileProfile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile Safari/604.1" });
const samsung = mobileProfile({ userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 Chrome/140.0 Mobile SamsungBrowser/29.0" });
const device = (mobile = iphone) => ({ checkedAt: 1, cpuThreads: 8, ramEstimateGB: null, cpu: { wasm: true, simd: true, threads: 1 }, gpu: "available", gpuName: "", gpuVendor: "unknown", features: ["shader-f16"], maxBufferBytes: 2 ** 30, maxStorageBufferBytes: 2 ** 30, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 20, workerAvailable: true, mobile });

test("phone hints distinguish iPhone, Galaxy, reduced Android and iPad without guessing exact hardware", () => {
  assert.deepEqual(iphone, { family: "iphone", mobile: true });
  assert.deepEqual(samsung, { family: "samsung", mobile: true });
  assert.equal(mobileProfile({ userAgent: "Linux; Android 15; K", userAgentData: { mobile: true } }).family, "android");
  assert.equal(mobileProfile({ platform: "MacIntel", userAgent: "Macintosh", maxTouchPoints: 5 }).family, "ipad");
  assert.equal(mobileProfile({ platform: "MacIntel", maxTouchPoints: 0 }).mobile, false);
  assert.equal(mobileProfile({ platform: "Win32", maxTouchPoints: 10 }).mobile, false);
  assert.equal(mobileProfile({ userAgentData: { mobile: true } }).family, "other");
  const restricted = { get userAgent() { throw Error("Private"); }, get userAgentData() { throw Error("Private"); } };
  assert.equal(mobileProfile(restricted).mobile, false);
  assert.deepEqual(Object.keys(iphone).sort(), ["family", "mobile"]);
});

test("live phone inspection preserves unknown RAM and checks actual GPU capabilities", async () => {
  const measured = await inspectDevice({ userAgent: "iPhone Mobile", hardwareConcurrency: 6, gpu: { requestAdapter: async () => null } }, { workerAvailable: true });
  assert.equal(measured.mobile.family, "iphone"); assert.equal(measured.ramEstimateGB, null); assert.equal(measured.gpu, "unavailable");
  assert.ok(measured.cpu.threads <= 2);
  for (const [label, expected] of [["Apple GPU", "apple"], ["Adreno 830", "qualcomm"], ["ARM Mali G925", "arm"], ["Samsung Xclipse AMD", "samsung"]]) assert.equal(gpuVendor(label), expected);
});

test("phone contexts and output budgets are smaller without raising small model limits", () => {
  assert.deepEqual(mobileExecutionLimits(iphone, "cpu", 4096), { contextWindow: 2048, outputTokens: 128, characterBudget: 2400, maxCpuThreads: 2 });
  assert.equal(mobileExecutionLimits(samsung, "webgpu", 4096).outputTokens, 256);
  assert.equal(mobileExecutionLimits(iphone, "webgpu", 1024).contextWindow, 1024);
  assert.equal(mobileExecutionLimits(undefined, "cpu", 4096).outputTokens, 384);
  assert.equal(mobileExecutionLimits(undefined, "webgpu", 4096).outputTokens, 768);
  assert.equal(mobileMemoryCeilings(undefined), null);
});

test("iPhone browser ceilings cannot be bypassed by entering desktop RAM or VRAM budgets", () => {
  const largerGpu = getConversationModel("Qwen2.5-1.5B-Instruct-q4f32_1-MLC");
  assert.ok(assessModel(largerGpu, device(), { ramGB: 128, gpuGB: 64 }).blockers.includes("mobile-memory"));
  assert.equal(assessModel(largerGpu, device(samsung), { ramGB: 12, gpuGB: 4 }).blockers.length, 0);
  assert.ok(assessCpuModel(cpuModels[1], device(), { ramGB: 128 }).blockers.includes("mobile-memory"));
  assert.equal(assessCpuModel(cpuModels[1], device(samsung), { ramGB: 12 }).blockers.length, 0);
});

test("phone presets prefer supported Qwen GPU precision and never treat an unavailable GPU as usable", () => {
  assert.equal(phoneGpuRecommendation(device()).id, "Qwen2.5-0.5B-Instruct-q4f16_1-MLC");
  assert.equal(phoneGpuRecommendation({ ...device(), features: [] }).id, defaultPhoneGpuModel);
  assert.equal(phoneGpuRecommendation({ ...device(), gpu: "unavailable" }), undefined);
  assert.equal(phoneGpuRecommendation({ ...device(), maxComputeWorkgroupStorageBytes: 16384 }), undefined);
  assert.equal(phoneGpuRecommendation({ ...device(), mobile: undefined }), undefined);
});

test("a lightweight phone CPU model can be tried with undisclosed RAM while larger models retain the RAM gate", () => {
  const tiny = cpuModels.find(model => model.id === defaultPhoneCpuModel);
  const report = assessCpuModel(tiny, device());
  assert.equal(report.blockers.length, 0); assert.ok(report.warnings.includes("ram-unknown"));
  assert.equal(tiny.weightBytes, 135658354); assert.equal(tiny.modelType, "llama"); assert.deepEqual(tiny.eosTokenIds, [2]); assert.equal(tiny.englishOnly, true);
  assert.equal(phoneCpuRecommendation(device()).id, tiny.id);
  assert.equal(phoneCpuRecommendation(device(), { ramGB: 8 }).id, cpuModels[0].id);
  assert.ok(assessCpuModel(cpuModels[0], device()).blockers.includes("ram-unknown"));
  assert.ok(assessCpuModel(tiny, { ...device(), mobile: undefined }).blockers.includes("ram-unknown"));
  assert.equal(phoneCpuRecommendation({ ...device(), cpu: { wasm: false, simd: false, threads: 1 } }), undefined);
});

test("the phone GPU runtime gate checks again before downloading and passes its measured profile to initialization", async () => {
  const model = getConversationModel(defaultPhoneGpuModel), signal = new AbortController().signal; let starts = 0;
  const value = await withModelResources(model, { signal, inspect: async () => device() }, async measured => { starts++; return mobileExecutionLimits(measured.mobile, "webgpu", model.contextWindow); });
  assert.equal(starts, 1); assert.equal(value.contextWindow, 2048);
  await assert.rejects(withModelResources(model, { signal, inspect: async () => ({ ...device(), gpu: "unavailable" }) }, async () => { starts++; }), /model_resources_webgpu/);
  assert.equal(starts, 1);
});

test("mobile prompt budgets keep the current question intact and protect the selected continuation pair", () => {
  const question = "q".repeat(300);
  const history = [{ role: "user", content: "old".repeat(300) }, { role: "assistant", content: "old answer".repeat(150) }, { role: "user", content: "Recent question" }, { role: "assistant", content: "A".repeat(1200) }];
  const result = prepareConversation({ text: question, locale: "en", characterBudget: 2400, history, preserveLastPair: true });
  assert.equal(result.messages.at(-1).content, question); assert.equal(result.messages.length, 4); assert.equal(result.shortened, true);
  assert.throws(() => prepareConversation({ text: "q".repeat(2401), locale: "en", characterBudget: 2400 }), /conversation_input_too_long/);
  assert.throws(() => prepareConversation({ text: question, locale: "en", characterBudget: 2400, history: [{ role: "user", content: "Q" }, { role: "assistant", content: "A".repeat(2400) }], preserveLastPair: true }), /conversation_continuation_context/);
});

test("callers cannot raise a loaded phone runtime's prompt budget", async () => {
  let calls = 0;
  const session = new ConversationSession({ load: async id => ({ modelId: id, characterBudget: 2400, dispose() {}, adapter: { interrupt() {}, async stream() { calls++; return (async function* () { yield { choices: [{ delta: { content: "Hello" } }] }; })(); } } }) });
  await session.load(defaultPhoneGpuModel); assert.equal(session.characterBudget, 2400);
  await assert.rejects(session.generate({ text: "q".repeat(3000), locale: "en", characterBudget: 6000 }), /conversation_input_too_long/);
  assert.equal(calls, 0); await session.generate({ text: "Hello", locale: "en" }); assert.equal(calls, 1);
  session.unload(); assert.equal(session.characterBudget, 6000);
});

test("phone CPU context and token limits travel through the actual worker protocol", async () => {
  let received; const download = { weightBytes: 135658354, shardCount: 1, cachedShards: 1, cacheComplete: true, responseTested: true };
  const worker = { onmessage: null, onerror: null, onmessageerror: null, terminate() {}, postMessage(command) { queueMicrotask(() => handler(command)); } };
  const handler = createCpuWorkerHandler(async (_model, _threads, _progress, limits) => { received = limits; return { download, pipeline: { dispose() {}, async generate() { throw Error("not needed"); } } }; }, data => worker.onmessage?.({ data }));
  const client = new CpuWorkerClient(worker, () => assert.fail("Unexpected failure"));
  await client.load(defaultPhoneCpuModel, 1, () => {}, { contextWindow: 2048, outputTokens: 128 });
  assert.deepEqual(received, { contextWindow: 2048, outputTokens: 128 }); client.dispose();
  assert.deepEqual(cpuGenerationLimits(4096, { contextWindow: 99999, outputTokens: 99999 }), { contextWindow: 4096, outputTokens: 384 });
  assert.deepEqual(cpuGenerationLimits(4096, { contextWindow: NaN, outputTokens: Infinity }), { contextWindow: 4096, outputTokens: 384 });
});

test("phone model cache validation uses the pinned model architecture", async () => {
  const tiny = cpuModels.find(model => model.id === defaultPhoneCpuModel), signal = new AbortController().signal;
  await validateCpuFile(tiny, "config.json", new Response('{"model_type":"llama","max_position_embeddings":8192}'), signal);
  await assert.rejects(validateCpuFile(tiny, "config.json", new Response('{"model_type":"qwen2","max_position_embeddings":8192}'), signal), /cpu_download_metadata/);
});

function eventSource(extra) {
  const listeners = new Set();
  return { ...extra, addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); }, fire() { for (const listener of listeners) listener(); }, listeners };
}
test("phone background transitions release a loaded runtime once and never reload it on resume", async () => {
  let disposed = 0, loads = 0;
  const session = new ConversationSession({ load: async id => { loads++; return { modelId: id, dispose() { disposed++; }, adapter: { interrupt() {}, async stream() { throw Error("unused"); } } }; } });
  await session.load(defaultPhoneCpuModel);
  const page = eventSource({ visibilityState: "visible" });
  const close = connectMobileLifecycle(page, true, () => session.unload());
  const late = [...page.listeners][0];
  page.visibilityState = "hidden"; page.fire(); page.fire(); assert.equal(disposed, 1); assert.equal(session.ready, false);
  page.visibilityState = "visible"; page.fire(); assert.equal(loads, 1);
  close(); assert.equal(page.listeners.size, 0); late(); assert.equal(disposed, 1);
  const disabled = connectMobileLifecycle(page, false, () => assert.fail("Disabled background policy"));
  page.visibilityState = "hidden"; page.fire(); disabled();
});

test("the phone viewport follows the keyboard, preserves pinch zoom and ignores late resize callbacks", () => {
  const viewport = eventSource({ height: 820, scale: 1 }), applied = [];
  const close = connectMobileViewport(viewport, value => applied.push(value));
  assert.equal(applied.at(-1), 820); const late = [...viewport.listeners][0];
  viewport.height = 390; viewport.fire(); assert.equal(applied.at(-1), 390);
  viewport.scale = 2; viewport.fire(); assert.equal(applied.at(-1), null);
  viewport.scale = 1; viewport.height = NaN; viewport.fire(); assert.equal(applied.at(-1), null);
  close(); const count = applied.length; late(); assert.equal(applied.length, count); assert.equal(viewport.listeners.size, 0);
});

const MobileSupport = await loadComponent(new URL("../app/mobile-support.tsx", import.meta.url));
for (const locale of ["en", "de"]) {
  test(`${locale}: phone setup explains the iPhone CPU fallback and Galaxy GPU without inventing memory`, () => {
    const props = { locale, budget: {}, disabled: false, pauseInBackground: true, onSelect() {} };
    const ios = renderToStaticMarkup(createElement(MobileSupport, { ...props, device: { ...device(), gpu: "unavailable" } }));
    assert.match(ios, /iPhone/); assert.match(ios, /SmolLM2 135M/); assert.match(ios, /Safari/); assert.match(ios, /135M/);
    assert.match(ios, /2048/); assert.match(ios, /128/); assert.match(ios, /checked=/); assert.match(ios, /disabled=/);
    assert.match(ios, locale === "de" ? /vor allem für Englisch/ : /English-first/);
    const galaxy = renderToStaticMarkup(createElement(MobileSupport, { ...props, device: device(samsung), budget: { ramGB: 8 } }));
    assert.match(galaxy, /Samsung Galaxy/); assert.match(galaxy, /Qwen/); assert.match(galaxy, /Xclipse/); assert.match(galaxy, /Adreno/);
    const desktop = renderToStaticMarkup(createElement(MobileSupport, { ...props, device: { ...device(), mobile: { family: "desktop", mobile: false } } }));
    assert.equal(desktop, "");
  });
}
