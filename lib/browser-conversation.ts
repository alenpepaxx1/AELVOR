// Copyright © 2026 Alen Pepa
import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";
import ConversationWorker from "./conversation.worker.ts?worker";
import { aborted, abortable, isConversationModel, type ConversationModelId, type GenerationAdapter } from "./conversation.ts";
import { serialGeneration } from "./serial-generation.ts";
import { asError } from "./errors.ts";
import { getConversationModel } from "./model-catalog.ts";
import { normalizeDeviceBudget, type DeviceBudget } from "./device-capabilities.ts";
import { withModelResources } from "./model-load-gate.ts";
import { clearModelCache, inspectModelCache, prepareModelDownload, type DownloadInfo } from "./model-download.ts";
import { chatProfile, monotonicProgress, verifyChatCompatibility } from "./model-readiness.ts";
import { mobileExecutionLimits } from "./mobile-device.ts";
import { loadedGpuFromProgress, requireLoadedGpu, type GpuPreference, type RuntimeGpuInfo } from "./gpu-selection.ts";
import { requireGpuBudgetMatch } from "./hardware-budget.ts";

export type LoadingProgress = { progress: number; text: string; download?: DownloadInfo };
export type BrowserConversation = { adapter: GenerationAdapter; modelId: ConversationModelId; dispose: () => void; download: DownloadInfo; characterBudget: number; gpu?: RuntimeGpuInfo };

export async function loadBrowserConversation(modelId: ConversationModelId, options: { signal: AbortSignal; onProgress: (progress: LoadingProgress) => void; onFatal: () => void; budget?: DeviceBudget; gpuPreference?: GpuPreference }): Promise<BrowserConversation> {
  if (!getConversationModel(modelId)) throw new Error("unsupported_model");
  if (options.signal.aborted) throw aborted();
  const model = getConversationModel(modelId)!;
  const budget = normalizeDeviceBudget(options.budget);
  options.onProgress({ progress: 0, text: "Checking CPU, WebGPU, RAM estimate and memory budgets… / CPU, WebGPU, RAM-Schätzung und Speicherbudgets prüfen…" });
  // Always recheck here, even when the selection panel already ran a probe.
  // No worker or model download starts before this resource gate passes.
  return withModelResources(model, { ...options, budget }, async device => {
    const limits = mobileExecutionLimits(device.mobile, "webgpu", model.contextWindow);
    const record = prebuiltAppConfig.model_list.find(model => model.model_id === modelId);
    if (!record) throw new Error("unsupported_model");
    if (record.model.replace(/\/$/, "") !== model.sourceUrl.replace(/\/$/, "")) throw new Error("model_identity_mismatch");
    let download: DownloadInfo | undefined;
    const progress = monotonicProgress(value => options.onProgress({ ...value, download }));
    progress(0.01, "Checking publisher metadata and model files… / Metadaten und Modelldateien prüfen…");
    const plan = await prepareModelDownload(record, options.signal);
    download = await inspectModelCache(plan, options.signal, { repair: true, onShard: (index, count) => progress(0.03 + 0.06 * index / count, "Checking saved model parts… / Gespeicherte Modellteile prüfen…") });
    progress(0.1, "Downloading missing files and loading the model… / Fehlende Dateien laden und Modell starten…");
    if (options.signal.aborted) throw aborted();
    const worker = new ConversationWorker();
    const lifetime = new AbortController();
    let generation: ReturnType<typeof serialGeneration> | null = null;
    let loadedGpu: RuntimeGpuInfo | undefined;
    let closed = false, initializing = true, rejectWorker: (error: Error) => void = () => {};
    const workerFailure = new Promise<never>((_, reject) => { rejectWorker = reject; });
    const failure = () => { if (initializing) rejectWorker(new Error("model_worker_failed")); else if (!closed) options.onFatal(); };
    worker.addEventListener("error", failure);
    const terminate = () => { if (!closed) { closed = true; lifetime.abort(); generation?.dispose(); worker.removeEventListener("error", failure); worker.terminate(); } };
    options.signal.addEventListener("abort", terminate, { once: true });
    try {
      const engine = await abortable(Promise.race([
        CreateWebWorkerMLCEngine(worker, modelId, {
          appConfig: { model_list: [record], cacheBackend: "cache" },
          logLevel: "WARN",
          initProgressCallback: report => {
            if (closed) return;
            loadedGpu = loadedGpuFromProgress(report) || loadedGpu;
            progress(0.1 + 0.7 * report.progress, report.text);
          },
        }, { context_window_size: limits.contextWindow }),
        workerFailure,
      ]), options.signal);
      if (options.signal.aborted) throw aborted();
      requireLoadedGpu(loadedGpu, options.gpuPreference);
      requireGpuBudgetMatch(budget, { gpu: loadedGpu ? "available" : "unknown", gpuName: loadedGpu?.name || "", softwareGpu: loadedGpu?.software });
      download = await Promise.race([inspectModelCache(plan, lifetime.signal, { repair: false, onShard: (index, count) => progress(0.82 + 0.1 * index / count, "Verifying downloaded model parts… / Heruntergeladene Modellteile prüfen…") }), workerFailure]);
      progress(0.94, "Testing chat history and streamed responses… / Chatverlauf und Streaming-Antworten testen…");
      await Promise.race([verifyChatCompatibility({
        generate: async (messages, onText) => {
          const stream = await engine.chat.completions.create({ messages, ...chatProfile(modelId, limits.contextWindow), temperature: 0, max_tokens: Math.min(16, limits.outputTokens), stream: true });
          let text = "";
          for await (const chunk of stream) {
            if (lifetime.signal.aborted) throw aborted();
            const delta = chunk.choices[0]?.delta?.content;
            if (typeof delta === "string") { text += delta; onText(delta); }
          }
          return text;
        },
        reset: () => engine.resetChat(),
        interrupt: () => engine.interruptGenerate(),
      }, lifetime.signal), workerFailure]);
      if (options.signal.aborted) throw aborted();
      download = { ...download, responseTested: true };
      progress(0.99, "Local response verified. / Lokale Antwort geprüft.");
      initializing = false;
      generation = serialGeneration({
        reset: () => engine.resetChat(),
        stream: (messages, settings) => {
          const profile = chatProfile(modelId, limits.contextWindow, settings);
          return engine.chat.completions.create({ messages, stream: true, stream_options: { include_usage: true }, ...profile, max_tokens: Math.min(profile.max_tokens, limits.outputTokens) });
        },
        interrupt: () => { if (!closed) engine.interruptGenerate(); },
      });
      return { modelId, adapter: generation.adapter, dispose: terminate, download, characterBudget: limits.characterBudget, gpu: loadedGpu };
    } catch (error) { terminate(); throw asError(error, "model_load_failed"); }
    finally { options.signal.removeEventListener("abort", terminate); }
  });
}

export async function deleteConversationCache(modelId: ConversationModelId): Promise<void> {
  if (!isConversationModel(modelId)) throw new Error("unsupported_model");
  const record = prebuiltAppConfig.model_list.find(model => model.model_id === modelId);
  if (!record) throw new Error("unsupported_model");
  await clearModelCache(record);
}
