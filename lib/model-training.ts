// Copyright © 2026 Alen Pepa
import ModelTrainingWorker from "./model-training.worker.ts?worker";
import { trainWithWorker } from "./model-training-core.ts";
import type { ModelBundle, TrainOptions } from "./local-model.ts";

export function trainInWorker(examples: unknown, name = "AELVOR Hybrid v2", options: TrainOptions & { signal?: AbortSignal } = {}): Promise<ModelBundle> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("worker_unavailable"));
  // Vite's explicit worker import emits a same-origin asset URL in both the
  // Vinext client-reference analysis and final client build.
  return trainWithWorker(examples, name, options, () => new ModelTrainingWorker());
}
