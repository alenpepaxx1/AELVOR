// Copyright © 2026 Alen Pepa
import { trainLocalModel } from "./local-model.ts";
import type { TrainOptions } from "./local-model.ts";

// A dedicated worker can be terminated immediately without touching UI state.
self.onmessage = (event: MessageEvent<{ examples: unknown; name: string; epochs: TrainOptions["epochs"] }>) => {
  try {
    const bundle = trainLocalModel(event.data.examples, event.data.name, { epochs: event.data.epochs, onProgress: progress => self.postMessage({ type: "progress", progress }) });
    self.postMessage({ type: "complete", bundle });
  } catch (error) { self.postMessage({ type: "error", error: error instanceof Error ? error.message : "invalid_dataset" }); }
};
