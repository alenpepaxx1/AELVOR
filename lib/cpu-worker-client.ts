// Copyright © 2026 Alen Pepa
import { aborted, type GenerationAdapter, type GenerationChunk } from "./conversation.ts";
import type { CpuCommand, CpuProgress, CpuReply, CpuLimits } from "./cpu-worker-protocol.ts";
import type { DownloadInfo } from "./model-download.ts";
import { getCpuModel } from "./cpu-models.ts";
import { requireTestedDownload } from "./model-readiness.ts";

export type CpuWorker = { postMessage: (value: CpuCommand) => void; terminate: () => void; onmessage: ((event: MessageEvent<CpuReply>) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null };
type Job = { id: number; queue: GenerationChunk[]; done: boolean; failure?: Error; wake?: () => void };

export class CpuWorkerClient {
  private worker: CpuWorker;
  private sequence = 0;
  private disposed = false;
  private ready = false;
  private job: Job | null = null;
  private loading: { id: number; modelId: string; progress: (value: CpuProgress) => void; resolve: (download: DownloadInfo) => void; reject: (error: Error) => void } | null = null;
  constructor(worker: CpuWorker, onFatal: () => void) {
    this.worker = worker;
    worker.onmessage = event => this.receive(event.data);
    const fatal = () => { if (this.disposed) return; this.dispose(Error("model_worker_failed")); onFatal(); };
    worker.onerror = fatal; worker.onmessageerror = fatal;
  }
  private receive(reply: CpuReply) {
    if (this.disposed || !reply) return;
    const loading = this.loading;
    if (loading && reply.id === loading.id) {
      if (reply.type === "progress") loading.progress(reply.value);
      if (reply.type === "ready") {
        this.loading = null;
        if (reply.modelId !== loading.modelId) { loading.reject(Error("model_identity_mismatch")); this.dispose(); }
        else {
          try {
            const model = getCpuModel(loading.modelId); if (!model) throw Error("unsupported_model");
            requireTestedDownload(reply.download, model.weightBytes, 1);
            this.ready = true; loading.resolve(reply.download);
          } catch (error) { loading.reject(error instanceof Error ? error : Error("model_response_test_metadata")); this.dispose(); }
        }
      }
      if (reply.type === "error") { this.loading = null; loading.reject(Error(reply.error)); }
      return;
    }
    const job = this.job; if (!job || job.id !== reply.id) return;
    if (reply.type === "chunk") job.queue.push(reply.chunk);
    if (reply.type === "done" || reply.type === "error") {
      job.done = true; this.job = null;
      if (reply.type === "error") job.failure = Error(reply.error);
    }
    job.wake?.(); job.wake = undefined;
  }
  load(modelId: string, threads: number, progress: (value: CpuProgress) => void, limits?: CpuLimits): Promise<DownloadInfo> {
    if (this.disposed) return Promise.reject(Error("model_not_ready"));
    if (this.loading || this.job) return Promise.reject(Error("model_busy"));
    this.ready = false;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.loading = { id, modelId, progress, resolve, reject };
      try { this.worker.postMessage({ type: "load", id, modelId, threads, limits }); }
      catch { this.dispose(Error("model_worker_failed")); }
    });
  }
  readonly adapter: GenerationAdapter = {
    interrupt: () => this.dispose(aborted()),
    stream: async (messages, signal, settings) => {
      if (signal?.aborted) throw aborted();
      if (this.disposed || !this.ready) throw Error("model_not_ready");
      if (this.job || this.loading) throw Error("model_busy");
      const job: Job = { id: ++this.sequence, queue: [], done: false }; this.job = job;
      let closed = false;
      try { this.worker.postMessage({ type: "generate", id: job.id, messages, settings }); }
      catch { this.dispose(Error("model_worker_failed")); }
      const close = async (): Promise<IteratorResult<GenerationChunk>> => {
        closed = true;
        if (!job.done && this.job === job) this.dispose(aborted());
        job.queue = []; return { done: true, value: undefined };
      };
      const iterator: AsyncIterableIterator<GenerationChunk> = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          if (closed) return { done: true, value: undefined };
          if (signal?.aborted) throw aborted();
          while (!job.queue.length && !job.done) await new Promise<void>(resolve => { job.wake = resolve; });
          if (closed) return { done: true, value: undefined };
          if (signal?.aborted) throw aborted();
          const chunk = job.queue.shift();
          if (chunk) return { done: false, value: chunk };
          if (job.failure) throw job.failure;
          return { done: true, value: undefined };
        },
        return: close,
      };
      return iterator;
    },
  };
  dispose(error = Error("model_not_ready")) {
    if (this.disposed) return;
    this.disposed = true; this.ready = false;
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null; this.worker.terminate();
    this.loading?.reject(error); this.loading = null;
    if (this.job) { this.job.queue = []; this.job.failure = error; this.job.done = true; this.job.wake?.(); this.job.wake = undefined; this.job = null; }
  }
}
