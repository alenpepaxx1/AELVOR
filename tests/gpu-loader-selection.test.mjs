// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { gpuRuntimeFixture } from "./support/gpu-runtime-fixture.mjs";
import { defaultConversationModel } from "../lib/conversation.ts";
import { ConversationSession } from "../lib/conversation-session.ts";

const detected = name => ({ checkedAt: 1, cpuThreads: 16, ramEstimateGB: 32, gpu: "available", gpuName: name, features: ["shader-f16"], maxBufferBytes: 2 ** 30, maxStorageBufferBytes: 2 ** 30, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 50, workerAvailable: true });
const report = name => ({ progress: 1, text: `Finish loading on WebGPU - ${name}` });
const options = () => ({ signal: new AbortController().signal, budget: { ramGB: 32, gpuGB: 12 }, gpuPreference: "nvidia", onProgress() {}, onFatal() {} });

test("the real browser loader rejects Intel before any model download or Worker starts", async () => {
  const fixture = await gpuRuntimeFixture({ device: detected("Intel Iris Xe"), reports: [report("NVIDIA RTX 4060")] });
  try {
    await assert.rejects(fixture.load(defaultConversationModel, options()), /model_resources_gpu-selection/);
    assert.equal(fixture.state.downloads, 0); assert.equal(fixture.state.workers, 0); assert.equal(fixture.state.warmReplies, 0);
  } finally { fixture.cleanup(); }
});

test("an NVIDIA probe followed by an Intel model worker is terminated before the readiness response test", async () => {
  const fixture = await gpuRuntimeFixture({ device: detected("NVIDIA RTX 4060"), reports: [report("Intel Iris Xe")] });
  try {
    await assert.rejects(fixture.load(defaultConversationModel, options()), /gpu_selection_nvidia_mismatch/);
    assert.equal(fixture.state.terminated, 1); assert.equal(fixture.state.warmReplies, 0);
  } finally { fixture.cleanup(); }
});

test("successful NVIDIA loading reports the model-worker GPU and clears that identity on unload", async () => {
  const fixture = await gpuRuntimeFixture({ device: detected("NVIDIA probe label"), reports: [report("NVIDIA GeForce RTX 4060 Laptop GPU")] });
  const session = new ConversationSession({ load: (id, callbacks) => fixture.load(id, { ...options(), ...callbacks }) });
  try {
    await session.load(defaultConversationModel);
    assert.equal(session.ready, true); assert.equal(fixture.state.warmReplies, 2);
    assert.equal(fixture.state.resets, 1);
    assert.deepEqual(fixture.state.warmRequests[1].messages.map(message => message.role), ["system", "user", "assistant", "user"]);
    assert.ok(fixture.state.warmRequests.every(request => request.stream && request.max_tokens === 16));
    assert.equal(session.getSnapshot().gpu.name, "NVIDIA GeForce RTX 4060 Laptop GPU");
    assert.equal(session.getSnapshot().gpu.source, "model-worker");
    session.unload(); assert.equal(session.ready, false); assert.equal(session.getSnapshot().gpu, undefined);
    assert.equal(fixture.state.terminated, 1);
  } finally { session.unload(); fixture.cleanup(); }
});

test("a model that fails the real history/streaming probe is unloaded and never becomes ready", async () => {
  const fixture = await gpuRuntimeFixture({ device: detected("NVIDIA RTX 4060"), reports: [report("NVIDIA RTX 4060")], failWarmupAt: 2 });
  const session = new ConversationSession({ load: (id, callbacks) => fixture.load(id, { ...options(), ...callbacks }) });
  try {
    await assert.rejects(session.load(defaultConversationModel), /template incompatible/);
    assert.equal(session.ready, false); assert.equal(fixture.state.warmReplies, 2); assert.equal(fixture.state.terminated, 1);
    await assert.rejects(session.generate({ text: "Hello", locale: "en" }), /model_not_ready/);
  } finally { session.unload(); fixture.cleanup(); }
});

test("hidden model-worker identity fails an explicit NVIDIA requirement while Automatic remains available", async () => {
  for (const gpuPreference of ["nvidia", "auto"]) {
    const fixture = await gpuRuntimeFixture({ device: detected("NVIDIA RTX 4060"), reports: [] });
    try {
      if (gpuPreference === "nvidia") await assert.rejects(fixture.load(defaultConversationModel, { ...options(), gpuPreference }), /gpu_selection_nvidia_unknown/);
      else { const runtime = await fixture.load(defaultConversationModel, { ...options(), gpuPreference }); assert.equal(runtime.gpu, undefined); runtime.dispose(); }
    } finally { fixture.cleanup(); }
  }
});
