// Copyright © 2026 Alen Pepa
import type { ModelBundle, TrainOptions, TrainProgress } from "./local-model.ts";

export function trainWithWorker(examples: unknown, name: string, options: TrainOptions & { signal?: AbortSignal }, createWorker: () => Worker): Promise<ModelBundle> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const finish = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("Aborted", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error("training_failed")); };
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: TrainProgress; bundle?: ModelBundle; error?: string }>) => {
      if (event.data.type === "progress" && event.data.progress) options.onProgress?.(event.data.progress);
      else if (event.data.type === "complete" && event.data.bundle) { finish(); resolve(event.data.bundle); }
      else if (event.data.type === "error") { finish(); reject(new Error(event.data.error || "invalid_dataset")); }
    };
    try { worker.postMessage({ examples, name, epochs: options.epochs ?? 40 }); }
    catch (error) { finish(); reject(error); }
  });
}
