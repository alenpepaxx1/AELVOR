// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { Worker as ThreadWorker } from "node:worker_threads";
import { once } from "node:events";
import { trainWithWorker } from "../lib/model-training-core.ts";
import { starterExamples, validateModel } from "../lib/local-model.ts";

const threads = [];
const trainInWorker = (examples, name, options = {}) => trainWithWorker(examples, name, options, () => new WorkerAdapter(new URL("../lib/model-training.worker.ts", import.meta.url)));
class WorkerAdapter {
  constructor(url) {
    this.thread = new ThreadWorker(new URL("./support/model-worker-host.mjs", import.meta.url), { workerData: { entry: url.href } });
    this.thread.on("message", data => this.onmessage?.({ data }));
    this.thread.on("error", error => this.onerror?.(error));
    threads.push(this.thread);
  }
  postMessage(data) { this.thread.postMessage(data); }
  terminate() { this.thread.terminate(); }
}

test("the real background entry returns trained weights and forwards cross-validation progress", async () => {
    const progress = [];
    const bundle = await trainInWorker(starterExamples, "Worker test", { epochs: 20, onProgress: value => progress.push(value) });
    assert.equal(validateModel(bundle.model).name, "Worker test");
    assert.equal(bundle.evaluation.total, 96);
    assert.deepEqual([...new Set(progress.filter(item => item.fold).map(item => item.fold))], [1, 2, 3]);
    assert.equal(progress.at(-1).progress, 1);
    assert.equal(progress.at(-1).epoch, 20);
    await once(threads.at(-1), "exit");
});

test("cancellation terminates running training and rejects without returning a replacement model", async () => {
    const controller = new AbortController(); let aborted = false;
    const promise = trainInWorker(starterExamples, "Cancelled", { epochs: 80, signal: controller.signal, onProgress: progress => { if (progress.fold === 1 && !aborted) { aborted = true; controller.abort(); } } });
    const exit = once(threads.at(-1), "exit");
    await assert.rejects(promise, error => error.name === "AbortError");
    assert.equal(aborted, true);
    await exit;
    const previousCount = threads.length;
    await assert.rejects(trainInWorker(starterExamples, "Never started", { signal: controller.signal }), error => error.name === "AbortError");
    assert.equal(threads.length, previousCount);
});

test("worker-side validation errors return through the public training boundary", async () => {
    const promise = trainInWorker([], "Invalid");
    const exit = once(threads.at(-1), "exit");
    await assert.rejects(promise, /dataset_size/);
    await exit;
});
