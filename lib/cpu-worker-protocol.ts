// Copyright © 2026 Alen Pepa
import { getCpuModel, type CpuModel } from "./cpu-models.ts";
import { errorMessage } from "./errors.ts";
import type { PromptMessage, GenerationChunk } from "./conversation.ts";
import type { DownloadInfo } from "./model-download.ts";
import { normalizeGenerationSettings, type GenerationSettings } from "./generation-policy.ts";
import { requireTestedDownload } from "./model-readiness.ts";

export type CpuResult = { text: string; finishReason: string; completionTokens: number; promptTokens: number };
export type CpuPipeline = { generate: (messages: PromptMessage[], onText: (text: string) => void, settings?: GenerationSettings) => Promise<CpuResult>; dispose: () => void };
export type CpuProgress = { progress: number; text: string; download?: DownloadInfo };
export type CpuReply =
  | { type: "progress"; id: number; value: CpuProgress }
  | { type: "ready"; id: number; modelId: string; download: DownloadInfo }
  | { type: "chunk"; id: number; chunk: GenerationChunk }
  | { type: "done"; id: number }
  | { type: "error"; id: number; error: string };
export type CpuLimits = { contextWindow: number; outputTokens: number };
export type CpuCommand = { type: "load"; id: number; modelId: string; threads: number; limits?: CpuLimits } | { type: "generate"; id: number; messages: PromptMessage[]; settings?: GenerationSettings };
export type CpuLoader = (model: CpuModel, threads: number, progress: (value: CpuProgress) => void, limits?: CpuLimits) => Promise<{ pipeline: CpuPipeline; download: DownloadInfo }>;
export function cpuGenerationLimits(contextWindow: number, input?: CpuLimits): CpuLimits {
  const context = Number.isFinite(input?.contextWindow) ? Math.max(512, Math.min(contextWindow, Math.floor(input!.contextWindow))) : contextWindow;
  const output = Number.isFinite(input?.outputTokens) ? Math.floor(input!.outputTokens) : 384;
  return { contextWindow: context, outputTokens: Math.max(16, Math.min(384, Math.floor(context / 2), output)) };
}

function cpuFailureCode(failure: unknown, loading: boolean): string {
  const message = errorMessage(failure, "cpu_inference_failed").slice(0, 400);
  if (/^(?:cpu_|model_|unsupported_model)|context.*(?:window|exceed)|tokens.*exceed/i.test(message)) return message;
  if (loading) {
    const name = failure && typeof failure === "object" && "name" in failure ? failure.name : "";
    if (name === "SecurityError" || name === "NotAllowedError" || name === "QuotaExceededError") return "model_download_cache_unavailable";
    // Messages come from the pinned Transformers.js Hub HTTP error mapping.
    if (/unauthorized|forbidden|(?:HTTP|status|error)[\s(:=]*40[13]\b/i.test(message)) return "cpu_download_denied";
    if (/could not locate file|(?:HTTP|status|error)[\s(:=]*404\b/i.test(message)) return "cpu_download_missing";
    if (/failed to fetch|fetch failed|network|download|(?:HTTP|status|error)[\s(:=]*(?:429|5\d\d)\b/i.test(message)) return "cpu_download_network";
  }
  return /memory|allocation|out.of.bounds|buffer/i.test(message) ? `cpu_memory: ${message}` : `cpu_inference_failed: ${message}`;
}

export function createCpuWorkerHandler(load: CpuLoader, emit: (reply: CpuReply) => void) {
  let pipeline: CpuPipeline | null = null, busy = false;
  return async (command: CpuCommand) => {
    if (!command || !Number.isSafeInteger(command.id)) return;
    if (busy) { emit({ type: "error", id: command.id, error: "model_busy" }); return; }
    busy = true;
    try {
      if (command.type === "load") {
        const model = getCpuModel(command.modelId); if (!model) throw Error("unsupported_model");
        pipeline?.dispose(); pipeline = null;
        const runtime = await load(model, Math.max(1, Math.min(8, Math.floor(command.threads) || 1)), value => emit({ type: "progress", id: command.id, value }), cpuGenerationLimits(model.contextWindow, command.limits));
        try { requireTestedDownload(runtime.download, model.weightBytes, 1); }
        catch (error) { try { runtime.pipeline.dispose(); } catch { /* Keep the compatibility failure. */ } throw error; }
        pipeline = runtime.pipeline;
        emit({ type: "ready", id: command.id, modelId: model.id, download: runtime.download });
      } else if (command.type === "generate") {
        if (!pipeline) throw Error("model_not_ready");
        if (!Array.isArray(command.messages) || !command.messages.length || command.messages.length > 20 || command.messages.some(message => !message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") || command.messages.reduce((sum, message) => sum + message.content.length, 0) > 16000) throw Error("conversation_input_too_long");
        const result = await pipeline.generate(command.messages, text => emit({ type: "chunk", id: command.id, chunk: { choices: [{ delta: { content: text } }] } }), normalizeGenerationSettings(command.settings));
        emit({ type: "chunk", id: command.id, chunk: { choices: [{ finish_reason: result.finishReason }], usage: { completion_tokens: result.completionTokens, prompt_tokens: result.promptTokens } } });
        emit({ type: "done", id: command.id });
      } else throw Error("cpu_invalid_command");
    } catch (failure) {
      emit({ type: "error", id: command.id, error: cpuFailureCode(failure, command.type === "load") });
    }
    finally { busy = false; }
  };
}
