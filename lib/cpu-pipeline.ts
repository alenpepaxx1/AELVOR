// Copyright © 2026 Alen Pepa
import { env, pipeline, TextStreamer, Tensor } from "@huggingface/transformers";
import { verifiedCpuCache, cpuCacheName } from "./cpu-cache.ts";
import { cpuRuntimeDirectory } from "./cpu-models.ts";
import { cpuGenerationLimits, type CpuLoader, type CpuResult } from "./cpu-worker-protocol.ts";
import type { PromptMessage } from "./conversation.ts";
import type { GenerationSettings } from "./generation-policy.ts";
import { cpuGenerationOptions } from "./cpu-generation.ts";
import { verifyChatCompatibility } from "./model-readiness.ts";

export const createCpuPipeline: CpuLoader = async (model, threads, progress, profile) => {
  const limits = cpuGenerationLimits(model.contextWindow, profile);
  env.allowLocalModels = false; env.useFS = false; env.useFSCache = false; env.useBrowserCache = false;
  const controller = new AbortController();
  const cache = verifiedCpuCache(model, await caches.open(cpuCacheName), controller.signal);
  env.useCustomCache = true; env.customCache = cache;
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = new URL(cpuRuntimeDirectory, self.location.origin).href;
  wasm.numThreads = threads; wasm.proxy = false;
  let weightBytes = 0;
  const generator = await pipeline("text-generation", model.repo, {
    revision: model.revision, dtype: "q8", device: "wasm",
    progress_callback: value => {
      if ("file" in value && value.file === "onnx/model_quantized.onnx") {
        if (value.status === "progress") {
          weightBytes = value.loaded;
          if (weightBytes > model.weightBytes) throw Error("cpu_download_size");
          progress({ progress: Math.min(0.85, weightBytes / model.weightBytes * 0.85), text: `CPU · ${(weightBytes / 1e9).toFixed(2)} / ${(model.weightBytes / 1e9).toFixed(2)} GB` });
        }
        if (value.status === "done" && weightBytes !== model.weightBytes) throw Error("cpu_download_size");
      }
    },
  });
  const run = async (messages: PromptMessage[], onText: (text: string) => void, maximum: number, settings?: GenerationSettings): Promise<CpuResult> => {
    const options = cpuGenerationOptions(limits.contextWindow, maximum, settings), limit = options.max_new_tokens;
    const inputs = generator.tokenizer.apply_chat_template(messages, { tokenize: true, return_dict: true, add_generation_prompt: true }) as { input_ids: Tensor; attention_mask: Tensor };
    const promptTokens = inputs.input_ids.dims.at(-1)!;
    if (promptTokens + limit > limits.contextWindow) throw Error("context window exceeded");
    const streamer = new TextStreamer(generator.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onText });
    // The SDK merges these generation keywords with the model's own EOS config.
    const generation = { ...inputs, streamer, ...options };
    const output = await generator.model.generate(generation) as Tensor;
    const sequence = output.tolist()[0] as bigint[];
    const tokens = sequence.slice(promptTokens), last = Number(tokens.at(-1));
    return { text: generator.tokenizer.decode(tokens, { skip_special_tokens: true }), promptTokens, completionTokens: tokens.length, finishReason: tokens.length >= limit && !(model.eosTokenIds || [151645, 151643]).includes(last) ? "length" : "stop" };
  };
  try {
    progress({ progress: 0.9, text: "CPU · Testing chat history and streaming… / Chatverlauf und Streaming testen…" });
    await verifyChatCompatibility({
      generate: async (messages, onText) => (await run(messages, onText, 8)).text,
      reset: async () => {}, // Each Transformers generation receives fresh inputs.
      // A failed CPU load is terminated by its parent worker client. Keep the
      // timeout distinct from an external abort; ONNX generation has no signal.
      interrupt: () => {},
    }, controller.signal);
    return { pipeline: { generate: (messages, onText, settings) => run(messages, onText, limits.outputTokens, settings), dispose: () => { controller.abort(); void generator.dispose().catch(() => {}); } }, download: await cache.summary(true) };
  } catch (error) { controller.abort(); void generator.dispose().catch(() => {}); throw error; }
};
