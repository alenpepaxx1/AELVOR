// Copyright © 2026 Alen Pepa
import { aborted, abortable, generateConversation, isConversationModel, type ConversationModelId, type ConversationRequest, type GenerationAdapter } from "./conversation.ts";
import { asError, errorMessage } from "./errors.ts";
import type { DownloadInfo } from "./model-download.ts";
import type { RuntimeGpuInfo } from "./gpu-selection.ts";

export type SessionState = Readonly<{ status: "idle" | "loading" | "ready" | "generating" | "error"; modelId: ConversationModelId | null; progress: number; progressText: string; error: string; download?: DownloadInfo; gpu?: RuntimeGpuInfo }>;
export const initialSessionState: SessionState = Object.freeze({ status: "idle", modelId: null, progress: 0, progressText: "", error: "" });
export type ConversationRuntime = { modelId: ConversationModelId; adapter: GenerationAdapter; dispose: () => void; download?: DownloadInfo; cancelRequiresReload?: boolean; characterBudget?: number; gpu?: RuntimeGpuInfo };
export type SessionLoader = (modelId: ConversationModelId, options: { signal: AbortSignal; onProgress: (value: { progress: number; text: string; download?: DownloadInfo }) => void; onFatal: () => void }) => Promise<ConversationRuntime>;

export class ConversationSession {
  private state: SessionState = initialSessionState;
  private listeners = new Set<() => void>();
  private runtime: ConversationRuntime | null = null;
  private loading: AbortController | null = null;
  private running: AbortController | null = null;
  private epoch = 0;
  private options: { load: SessionLoader; loadTimeoutMs?: number; stallTimeoutMs?: number };
  constructor(options: { load: SessionLoader; loadTimeoutMs?: number; stallTimeoutMs?: number }) { this.options = options; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get ready() { return this.runtime !== null && (this.state.status === "ready" || this.state.status === "generating"); }
  get characterBudget() { return this.runtime?.characterBudget ?? 6000; }
  private publish(value: SessionState) { this.state = Object.freeze(value); for (const listener of this.listeners) listener(); }
  unload() {
    this.epoch++; this.loading?.abort(); this.loading = null; this.running?.abort(); this.running = null;
    this.runtime?.dispose(); this.runtime = null; this.publish(initialSessionState);
  }
  async load(modelId: ConversationModelId): Promise<void> {
    if (!isConversationModel(modelId)) throw new Error("unsupported_model");
    if (this.running) throw new Error("model_busy");
    if (this.ready && this.runtime?.modelId === modelId) return;
    this.unload();
    const epoch = this.epoch, controller = new AbortController(); this.loading = controller;
    const current = () => this.epoch === epoch && this.loading === controller;
    this.publish({ ...initialSessionState, status: "loading", modelId });
    const timer = setTimeout(() => controller.abort(new Error("model_load_timeout")), this.options.loadTimeoutMs ?? 15 * 60 * 1000);
    try {
      const task = this.options.load(modelId, {
        signal: controller.signal,
        onProgress: value => { if (current() && !controller.signal.aborted) this.publish({ ...this.state, progress: Number.isFinite(value.progress) ? Math.max(this.state.progress, Math.min(0.99, value.progress)) : this.state.progress, progressText: value.text, download: value.download }); },
        onFatal: () => {
          if (this.epoch !== epoch) return;
          const error = new Error("model_worker_failed"); controller.abort(error); this.running?.abort(error);
          this.runtime?.dispose(); this.runtime = null;
          this.publish({ ...initialSessionState, status: "error", modelId, error: error.message });
        },
      });
      // Third-party loaders may resolve after cancellation; dispose their result.
      void task.then(runtime => { if (this.epoch !== epoch || controller.signal.aborted) runtime.dispose(); }).catch(() => {});
      const runtime = await abortable(task, controller.signal);
      if (!current() || controller.signal.aborted) throw aborted();
      if (runtime.modelId !== modelId) { runtime.dispose(); throw new Error("model_identity_mismatch"); }
      this.runtime = runtime;
      this.publish({ ...initialSessionState, status: "ready", modelId, progress: 1, download: runtime.download, ...(runtime.gpu ? { gpu: runtime.gpu } : {}) });
    } catch (failure) {
      const error = asError(controller.signal.aborted ? controller.signal.reason : failure, "model_load_failed");
      if (current()) this.publish({ ...initialSessionState, modelId, status: error.name === "AbortError" ? "idle" : "error", error: error.name === "AbortError" ? "" : error.message });
      if (this.epoch !== epoch) throw aborted();
      throw error;
    } finally { clearTimeout(timer); if (this.loading === controller) this.loading = null; }
  }
  async generate(request: ConversationRequest) {
    if (this.running) throw new Error("model_busy");
    if (!this.runtime || !this.ready) throw new Error("model_not_ready");
    if (request.signal?.aborted) throw aborted();
    const epoch = this.epoch, runtime = this.runtime, controller = new AbortController(); this.running = controller;
    const externalAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", externalAbort, { once: true });
    this.publish({ ...this.state, status: "generating" });
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error("generation_stalled")), this.options.stallTimeoutMs ?? 180_000); };
    arm();
    try {
      const reply = await generateConversation(runtime.adapter, { ...request, characterBudget: runtime.characterBudget, signal: controller.signal, onActivity: () => { if (this.epoch === epoch && !controller.signal.aborted) { arm(); request.onActivity?.(); } }, onPhase: phase => { if (this.epoch === epoch && !controller.signal.aborted) { arm(); request.onPhase?.(phase); } }, onDraft: text => { if (this.epoch === epoch && !controller.signal.aborted) request.onDraft?.(text); }, onText: text => { if (this.epoch === epoch && !controller.signal.aborted) { arm(); request.onText?.(text); } } });
      // A failed review interrupts the adapter. Keep its completed draft, but
      // never advertise a terminated CPU worker or failed GPU runtime as ready.
      if (reply.quality?.review === "review_failed" && this.epoch === epoch && this.runtime === runtime) {
        runtime.dispose(); this.runtime = null;
        this.publish({ ...initialSessionState, status: "error", modelId: runtime.modelId, error: "generation_review_failed" });
      }
      return reply;
    } catch (failure) {
      const error = asError(controller.signal.aborted ? controller.signal.reason : failure, "generation_failed");
      // The generation boundary interrupts on every terminal failure. CPU WASM
      // interruption terminates its worker; never advertise that runtime ready.
      if (this.epoch === epoch && this.runtime === runtime && runtime.cancelRequiresReload) {
        runtime.dispose(); this.runtime = null;
        this.publish(error.name === "AbortError" ? initialSessionState : { ...initialSessionState, status: "error", modelId: runtime.modelId, error: error.message });
      }
      if (this.epoch === epoch && this.runtime === runtime && /generation_stalled|memory|allocation|device.*lost|gpu.*lost|model_not_ready|worker/i.test(errorMessage(error))) {
        runtime.dispose(); this.runtime = null;
        this.publish({ ...initialSessionState, status: "error", modelId: runtime.modelId, error: error.message });
      }
      throw error;
    } finally {
      clearTimeout(timer!); request.signal?.removeEventListener("abort", externalAbort);
      if (this.running === controller) { this.running = null; if (this.epoch === epoch && this.runtime === runtime) this.publish({ ...this.state, status: "ready" }); }
    }
  }
}
