// Copyright © 2026 Alen Pepa
import { aborted, abortable, type PromptMessage } from "./conversation.ts";
import { normalizeGenerationSettings, type GenerationSettings } from "./generation-policy.ts";
import type { DownloadInfo } from "./model-download.ts";

export function requireTestedDownload(value: unknown, weightBytes: number, shardCount: number): asserts value is DownloadInfo {
  const item = value && typeof value === "object" ? value as Partial<DownloadInfo> : {};
  if (item.weightBytes !== weightBytes || item.shardCount !== shardCount || !Number.isSafeInteger(item.cachedShards) || item.cachedShards! < 0 || item.cachedShards! > shardCount || typeof item.cacheComplete !== "boolean" || item.cacheComplete && item.cachedShards !== shardCount || item.responseTested !== true) throw Error("model_response_test_metadata");
}

export function chatProfile(modelId: string, contextWindow: number, input?: GenerationSettings) {
  const settings = normalizeGenerationSettings(input);
  return { temperature: settings.temperature, top_p: settings.topP, max_tokens: Math.min(settings.maxOutputTokens, Math.floor(contextWindow / 2)), repetition_penalty: settings.repetitionPenalty,
    // WebLLM 0.2.86 explicitly supports this option for Qwen3 text models.
    ...(modelId.startsWith("Qwen3-") ? { extra_body: { enable_thinking: false } } : {}) };
}

export function monotonicProgress(report: (value: { progress: number; text: string }) => void) {
  let progress = 0;
  return (next: number, text: string) => {
    if (Number.isFinite(next)) progress = Math.max(progress, Math.min(0.99, Math.max(0, next)));
    report({ progress, text });
  };
}

// A loaded pipeline must actually produce text before it becomes chat-ready.
// The synthetic exchange is discarded and reset before user history is sent.
export async function verifyModelResponse(runtime: { reply: (testSignal: AbortSignal) => Promise<string>; reset: () => Promise<unknown>; interrupt: () => void }, signal: AbortSignal, timeoutMs = 90_000): Promise<void> {
  if (signal.aborted) throw aborted();
  const controller = new AbortController();
  const cancel = () => { controller.abort(); try { runtime.interrupt(); } catch { /* The worker may have closed. */ } };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const reply = await abortable(runtime.reply(controller.signal), controller.signal);
    if (controller.signal.aborted) throw aborted();
    await abortable(runtime.reset(), controller.signal);
    if (!reply.trim()) throw new Error("model_response_test_empty");
    if (signal.aborted) throw aborted();
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (controller.signal.aborted) throw new Error("model_response_test_timeout");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

// Exercise the same system/history roles and streamed text path used by chat.
// Nonempty output tests transport and template compatibility, not language skill.
export async function verifyChatCompatibility(runtime: { generate: (messages: PromptMessage[], onText: (text: string) => void) => Promise<string>; reset: () => Promise<unknown>; interrupt: () => void }, signal: AbortSignal, timeoutMs = 90_000): Promise<void> {
  await verifyModelResponse({
    interrupt: runtime.interrupt,
    reset: runtime.reset,
    reply: async testSignal => {
      const messages: PromptMessage[] = [{ role: "system", content: "You are a helpful assistant. Reply briefly in English or German as requested." }, { role: "user", content: "Say hello briefly in English." }];
      let active = true;
      const generate = async () => {
        if (testSignal.aborted) throw aborted();
        let streamed = "";
        const answer = await runtime.generate(messages.map(message => ({ ...message })), text => { if (active && !testSignal.aborted) streamed += text; });
        if (!active || testSignal.aborted) throw aborted();
        if (!answer.trim()) throw Error("model_response_test_empty");
        if (!streamed.trim()) throw Error("model_response_test_stream");
        return answer.trim();
      };
      try {
        const first = await generate();
        messages.push({ role: "assistant", content: first }, { role: "user", content: "Antworte jetzt kurz auf Deutsch: Hallo!" });
        return await generate();
      } finally { active = false; }
    },
  }, signal, timeoutMs);
}
