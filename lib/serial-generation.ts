// Copyright © 2026 Alen Pepa
import { AsyncMutex } from "./async-mutex.ts";
import { aborted, abortable, type GenerationAdapter, type GenerationChunk, type PromptMessage } from "./conversation.ts";
import { asError } from "./errors.ts";
import type { GenerationSettings } from "./generation-policy.ts";

type Bridge = { reset: () => Promise<void>; stream: (messages: PromptMessage[], settings?: GenerationSettings) => Promise<AsyncIterable<GenerationChunk>>; interrupt: () => void };

// Hold the lease until SDK iterator cleanup settles, including after UI abort.
// The next request can then reset context without racing a previous generation.
export function serialGeneration(bridge: Bridge) {
  const mutex = new AsyncMutex();
  const interrupt = () => { try { bridge.interrupt(); } catch { /* The worker may already be disposed. */ } };
  const adapter: GenerationAdapter = {
    interrupt,
    async stream(messages, signal, settings) {
      const release = await mutex.acquire(signal);
      let handedOff = false;
      try {
        const reset = bridge.reset();
        try { await abortable(reset, signal); }
        catch (error) { handedOff = true; void reset.finally(release).catch(() => {}); throw error; }
        if (signal?.aborted) throw aborted();
        const pending = bridge.stream(messages, settings);
        let source: AsyncIterable<GenerationChunk>;
        try { source = await abortable(pending, signal); }
        catch (error) {
          handedOff = true;
          void pending.then(async value => { await value[Symbol.asyncIterator]().return?.(); }).finally(release).catch(() => {});
          throw error;
        }
        const iterator = source[Symbol.asyncIterator]();
        let finished = false, closing: Promise<IteratorResult<GenerationChunk>> | null = null;
        const finish = () => { if (!finished) { finished = true; signal?.removeEventListener("abort", cancel); release(); } };
        const close = () => closing ??= Promise.resolve().then(async () => {
          try { return await iterator.return?.() || { done: true as const, value: undefined }; }
          finally { finish(); }
        });
        const cancel = () => { interrupt(); void close().catch(() => {}); };
        const wrapped: AsyncIterableIterator<GenerationChunk> = {
          [Symbol.asyncIterator]() { return this; },
          async next() {
            if (closing) return close();
            if (finished) return { done: true, value: undefined };
            try { const result = await iterator.next(); if (result.done) finish(); return result; }
            catch (error) { void close().catch(() => {}); throw asError(error); }
          },
          return: close,
        };
        handedOff = true;
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) { cancel(); throw aborted(); }
        return wrapped;
      } catch (error) { if (!handedOff) release(); throw asError(error); }
    },
  };
  return { adapter, dispose: () => { interrupt(); mutex.dispose(); } };
}
