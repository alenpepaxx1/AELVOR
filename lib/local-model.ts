// Copyright © 2026 Alen Pepa
import { fitLegacy, predict as predictLegacy, validateExamples as validateLegacyExamples, validateModel as validateLegacy, starterExamples as legacyExamples, type LocalModel as LegacyModel, type TrainingExample } from "./model-legacy.ts";
import { predictHybrid, trainHybrid, validateHybrid, validateExamples, type HybridModel, type AdvancedPrediction, type AdvancedEvaluation, type TrainOptions } from "./model-v2.ts";
import { additionalExamples } from "./model-data.ts";

export { validateExamples };
export type { TrainingExample, TrainOptions };
export type { TrainProgress, HybridModel, AdvancedEvaluation } from "./model-v2.ts";
export { pythonModelRunner } from "./model-python.ts";
export type LocalModel = LegacyModel | HybridModel;
export type Evaluation = AdvancedEvaluation;
export type ModelBundle = { model: LocalModel; examples: TrainingExample[]; evaluation: Evaluation | null };
export type Prediction = AdvancedPrediction;
export const starterExamples: TrainingExample[] = [...legacyExamples, ...additionalExamples];

export function trainLocalModel(input: unknown, name = "AELVOR Hybrid v2", options: TrainOptions = {}): ModelBundle { return trainHybrid(input, name, options); }
export function createStarterBundle(): ModelBundle { return trainLocalModel(starterExamples); }
export function validateModel(input: unknown): LocalModel {
  return (input as LocalModel)?.version === 2 ? validateHybrid(input) : validateLegacy(input);
}
export function predict(model: LocalModel, text: string): Prediction {
  if (model.version === 2) return predictHybrid(model, text);
  const legacy = predictLegacy(model, text);
  return { ...legacy, candidate: legacy.label, reason: legacy.label ? "accepted" : "unknown-vocabulary", margin: legacy.scores.length ? legacy.scores[0].score - legacy.scores[1].score : 0, wordCoverage: 0, charCoverage: 0, evidence: [] };
}

export function restoreBundle(input: unknown): ModelBundle {
  const value = input as ModelBundle;
  const model = validateModel(value?.model || input);
  if (value?.examples !== undefined && !Array.isArray(value.examples)) throw new Error("invalid_dataset");
  const examples = value?.examples?.length ? (model.version === 1 ? validateLegacyExamples : validateExamples)(value.examples) : [];
  // Claims in imported files are not trusted. Train again to recompute metrics.
  return { model, examples, evaluation: null };
}

// Custom v1 weights stay usable until the user explicitly retrains their data.
export function isLegacyStarter(bundle: ModelBundle): boolean {
  if (bundle.model.version !== 1 || bundle.model.name !== "AEGIS Local Classifier" || bundle.examples.length !== legacyExamples.length) return false;
  const keys = (examples: TrainingExample[]) => examples.map(item => `${item.label}\u0000${item.text}`).sort();
  if (JSON.stringify(keys(bundle.examples)) !== JSON.stringify(keys(legacyExamples))) return false;
  const expected = fitLegacy(legacyExamples, bundle.model.name);
  return (["labels", "vocabulary", "counts", "documentCounts", "tokenTotals", "sampleCount"] as const).every(key => JSON.stringify(bundle.model[key]) === JSON.stringify(expected[key]));
}
