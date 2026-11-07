// Copyright © 2026 Alen Pepa
import { fitLegacy, predict as predictLegacy, validateExamples as validateLegacyExamples, validateModel as validateLegacyShape, type TrainingExample } from "./model-legacy.ts";

export type TrainProgress = { phase: "validation" | "cross-validation" | "training"; progress: number; epoch?: number; epochs?: number; fold?: number; folds?: number; loss?: number };
export type TrainOptions = { epochs?: 20 | 40 | 80; onProgress?: (progress: TrainProgress) => void };
export type HybridModel = {
  format: "aegis-hybrid-text"; version: 2; name: string; createdAt: string;
  labels: string[]; vocabulary: string[]; documentCounts: number[];
  counts: number[][]; tokenTotals: number[]; sampleCount: number;
  idf: number[]; weights: number[][]; bias: number[];
  training: { epochs: 20 | 40 | 80; seed: number; learningRate: number; regularization: number; charWeight: number; linearBlend: number; loss: number[]; duplicatesRemoved: number };
  decision: { minScore: number; minMargin: number; minWordCoverage: number; minCharCoverage: number };
};
export type AdvancedEvaluation = {
  method: "stratified-3-fold"; folds: 3; seed: number; labels: string[];
  correct: number; total: number; accuracy: number; accepted: number; coverage: number;
  selectiveAccuracy: number | null; candidateAccuracy: number; macroF1: number; confusion: number[][];
  perLabel: { label: string; support: number; precision: number; recall: number; f1: number }[];
  baseline: { name: "Naive Bayes v1"; correct: number; accuracy: number };
};
export type AdvancedPrediction = {
  label: string | null; candidate: string | null; reason: "accepted" | "unknown-vocabulary" | "low-coverage" | "ambiguous";
  scores: { label: string; score: number }[]; knownFeatures: number; totalFeatures: number;
  wordCoverage: number; charCoverage: number; margin: number;
  evidence: { feature: string; contribution: number }[];
};

const seed = 173;
const stopWords = new Set("the a an is are to of and or for in on at with this that it be as from was were i you my your ein eine einer der die das und oder ist sind zu von im auf mit den dem des ich du mein bitte".split(" "));
const round = (value: number) => Math.round(value * 1e8) / 1e8;
const canonical = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function validateExamples(input: unknown): TrainingExample[] {
  const validated = validateLegacyExamples(input);
  const seen = new Map<string, TrainingExample>();
  for (const example of validated) {
    const key = canonical(example.text), previous = seen.get(key);
    if (previous && previous.label !== example.label) throw new Error("conflicting_labels");
    if (!previous) seen.set(key, example);
  }
  const unique = [...seen.values()];
  try { return validateLegacyExamples(unique); }
  catch { throw new Error("dataset_unique"); }
}

// Word boundaries keep character features local to words. All transformations are
// deterministic and mirrored by the exported, standard-library Python runner.
export function hybridFeatures(text: string): Map<string, number> {
  const words = (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,40}/gu) || []).filter(word => !stopWords.has(word)).slice(0, 1200);
  const result = new Map<string, number>();
  const add = (feature: string, cap: number) => result.set(feature, Math.min(cap, (result.get(feature) || 0) + 1));
  words.forEach((word, index) => {
    add(`w:${word}`, 3);
    if (index) add(`b:${words[index - 1]}~${word}`, 3);
    const padded = Array.from(`^${word}$`);
    for (const size of [3, 4, 5]) for (let start = 0; start <= padded.length - size; start++) add(`c:${padded.slice(start, start + size).join("")}`, 1);
  });
  return result;
}

function randomizer(initial: number) {
  let state = initial >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) { const target = Math.floor(random() * (index + 1)); [result[index], result[target]] = [result[target], result[index]]; }
  return result;
}
function softmax(logits: number[]): number[] {
  const maximum = Math.max(...logits), exps = logits.map(value => Math.exp(value - maximum)), total = exps.reduce((a, b) => a + b, 0);
  return exps.map(value => value / total);
}
function vectorize(raw: Map<string, number>, indices: Map<string, number>, idf: number[], charWeight: number): [number, number][] {
  const vector: [number, number][] = [];
  for (const [token, count] of raw) {
    const index = indices.get(token);
    if (index !== undefined) vector.push([index, (1 + Math.log(count)) * idf[index] * (token.startsWith("c:") ? charWeight : 1)]);
  }
  const norm = Math.sqrt(vector.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
  return vector.map(([index, value]) => [index, value / norm]);
}

function fit(examples: TrainingExample[], name: string, epochs: 20 | 40 | 80, duplicatesRemoved: number, onEpoch?: (epoch: number, loss: number) => void): HybridModel {
  const labels = [...new Set(examples.map(example => example.label))].sort(compare);
  const raw = examples.map(example => hybridFeatures(example.text));
  const documentFrequency = new Map<string, number>();
  for (const vector of raw) for (const token of vector.keys()) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  const ranked = [...documentFrequency].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
  // Reserve space for both representations; singleton character fragments add
  // little transfer signal and are excluded. Vocabulary is fit on training only.
  const vocabulary = [...ranked.filter(([token]) => !token.startsWith("c:")).slice(0, 2048), ...ranked.filter(([token, count]) => token.startsWith("c:") && count >= 2).slice(0, 2048)].map(([token]) => token);
  const indices = new Map(vocabulary.map((token, index) => [token, index]));
  const idf = vocabulary.map(token => round(1 + Math.log((1 + examples.length) / (1 + documentFrequency.get(token)!))));
  const charWeight = 0.45, learningRate = 0.7, regularization = 0.0005, linearBlend = 0.85;
  const vectors = raw.map(vector => vectorize(vector, indices, idf, charWeight));
  const counts = labels.map(() => vocabulary.map(() => 0)), documentCounts = labels.map(() => 0), tokenTotals = labels.map(() => 0);
  examples.forEach((example, index) => {
    const row = labels.indexOf(example.label); documentCounts[row]++;
    for (const [token, count] of raw[index]) { const column = indices.get(token); if (column !== undefined) { counts[row][column] += count; tokenTotals[row] += count; } }
  });
  const weights = labels.map(() => vocabulary.map(() => 0)), bias = labels.map(() => 0), loss: number[] = [];
  const order = examples.map((_, index) => index), random = randomizer(seed);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const rate = learningRate / Math.sqrt(1 + epoch / 8);
    let scale = 1;
    for (const index of shuffle(order, random)) {
      // Lazy dense L2 decay: scale all weights per sample without visiting the
      // whole matrix. Materialize once per epoch to keep magnitudes bounded.
      scale *= 1 - rate * regularization;
      const vector = vectors[index], target = labels.indexOf(examples[index].label);
      const scores = softmax(weights.map((row, label) => bias[label] + scale * vector.reduce((sum, [column, value]) => sum + row[column] * value, 0)));
      const balance = examples.length / (labels.length * documentCounts[target]);
      labels.forEach((_, label) => {
        const gradient = balance * ((label === target ? 1 : 0) - scores[label]);
        for (const [column, value] of vector) weights[label][column] += rate * gradient * value / scale;
        bias[label] += rate * gradient * 0.15;
      });
    }
    for (const row of weights) for (let column = 0; column < row.length; column++) row[column] *= scale;
    let epochLoss = 0;
    vectors.forEach((vector, index) => {
      const probabilities = softmax(weights.map((row, label) => bias[label] + vector.reduce((sum, [column, value]) => sum + row[column] * value, 0)));
      const target = labels.indexOf(examples[index].label);
      epochLoss -= Math.log(Math.max(1e-15, probabilities[target])) * examples.length / (labels.length * documentCounts[target]);
    });
    const penalty = weights.reduce((sum, row) => sum + row.reduce((inner, value) => inner + value * value, 0), 0);
    loss.push(round(epochLoss / examples.length + regularization * penalty / 2)); onEpoch?.(epoch + 1, loss[epoch]);
  }
  return {
    format: "aegis-hybrid-text", version: 2, name: name.trim().slice(0, 60) || "AELVOR Hybrid v2", createdAt: new Date().toISOString(), labels, vocabulary, counts, tokenTotals, documentCounts, sampleCount: examples.length,
    idf, weights: weights.map(row => row.map(round)), bias: bias.map(round),
    training: { epochs, seed, learningRate, regularization, charWeight, linearBlend, loss, duplicatesRemoved },
    decision: { minScore: 0.34, minMargin: 0.08, minWordCoverage: 0.18, minCharCoverage: 0.60 },
  };
}

export function predictHybrid(model: HybridModel, text: string): AdvancedPrediction {
  if (text.length > 20000) throw new Error("input_too_long");
  const raw = hybridFeatures(text), indices = new Map(model.vocabulary.map((token, index) => [token, index]));
  const known = [...raw].filter(([token]) => indices.has(token));
  const count = (prefix: string, values: Iterable<string>) => [...values].filter(token => token.startsWith(prefix)).length;
  const wordCount = count("w:", raw.keys()), charCount = count("c:", raw.keys());
  const wordCoverage = wordCount ? count("w:", known.map(([token]) => token)) / wordCount : 0;
  const charCoverage = charCount ? count("c:", known.map(([token]) => token)) / charCount : 0;
  const empty: AdvancedPrediction = { label: null, candidate: null, reason: "unknown-vocabulary", scores: [], knownFeatures: known.length, totalFeatures: raw.size, wordCoverage, charCoverage, margin: 0, evidence: [] };
  if (!known.length) return empty;
  const vector = vectorize(raw, indices, model.idf, model.training.charWeight);
  const linear = softmax(model.weights.map((row, label) => model.bias[label] + vector.reduce((sum, [column, value]) => sum + row[column] * value, 0)));
  // Length-normalized NB evidence avoids the exponential overconfidence of raw
  // long-document likelihoods. The mixing weight is fixed before evaluation.
  const weighted = known.map(([token, value]) => [indices.get(token)!, value * (token.startsWith("c:") ? model.training.charWeight : 1)] as const);
  const weightSum = weighted.reduce((sum, [, value]) => sum + value, 0) || 1;
  const nb = softmax(model.labels.map((_, label) => Math.log((model.documentCounts[label] + 1) / (model.sampleCount + model.labels.length)) + 8 * weighted.reduce((sum, [column, value]) => sum + value * Math.log((model.counts[label][column] + 1) / (model.tokenTotals[label] + model.vocabulary.length)), 0) / weightSum));
  const scores = model.labels.map((label, index) => ({ label, score: model.training.linearBlend * linear[index] + (1 - model.training.linearBlend) * nb[index] })).sort((a, b) => b.score - a.score || compare(a.label, b.label));
  const margin = scores[0].score - scores[1].score;
  const covered = wordCoverage >= model.decision.minWordCoverage || (charCoverage >= model.decision.minCharCoverage && known.length >= 8);
  const reason = !covered ? "low-coverage" : scores[0].score < model.decision.minScore || margin < model.decision.minMargin ? "ambiguous" : "accepted";
  const top = model.labels.indexOf(scores[0].label), runnerUp = model.labels.indexOf(scores[1].label);
  const evidence = vector.filter(([column]) => !model.vocabulary[column].startsWith("c:")).map(([column, value]) => ({ feature: model.vocabulary[column], contribution: value * (model.weights[top][column] - model.weights[runnerUp][column]) })).filter(item => item.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 6);
  return { ...empty, label: reason === "accepted" ? scores[0].label : null, candidate: scores[0].label, reason, scores, margin, evidence };
}

export function trainHybrid(input: unknown, name = "AELVOR Hybrid v2", options: TrainOptions = {}) {
  options.onProgress?.({ phase: "validation", progress: 0 });
  const examples = validateExamples(input).sort((a, b) => compare(a.label, b.label) || compare(canonical(a.text), canonical(b.text)));
  const duplicatesRemoved = (input as unknown[]).length - examples.length;
  const epochs = options.epochs ?? 40;
  if (![20, 40, 80].includes(epochs)) throw new Error("invalid_training_options");
  const labels = [...new Set(examples.map(example => example.label))].sort(compare);
  const groups = labels.map(label => examples.filter(example => example.label === label));
  const canEvaluate = examples.length >= 16 && groups.every(group => group.length >= 4);
  let evaluation: AdvancedEvaluation | null = null;
  const onFit = (fitIndex: number, fold?: number) => (epoch: number, loss: number) => options.onProgress?.({ phase: fold ? "cross-validation" : "training", progress: (fitIndex + epoch / epochs) / (canEvaluate ? 4 : 1), epoch, epochs, fold, folds: canEvaluate ? 3 : undefined, loss });
  if (canEvaluate) {
    const random = randomizer(seed), buckets: TrainingExample[][] = [[], [], []];
    for (const group of groups) shuffle(group, random).forEach((example, index) => buckets[index % 3].push(example));
    const confusion = labels.map(() => Array.from({ length: labels.length + 1 }, () => 0));
    let baselineCorrect = 0, candidateCorrect = 0;
    for (let fold = 0; fold < 3; fold++) {
      const training = buckets.flatMap((bucket, index) => index === fold ? [] : bucket), test = buckets[fold];
      const model = fit(training, name, epochs, 0, onFit(fold, fold + 1)), baseline = fitLegacy(training, name);
      for (const example of test) {
        const prediction = predictHybrid(model, example.text);
        if (prediction.candidate === example.label) candidateCorrect++;
        confusion[labels.indexOf(example.label)][prediction.label === null ? labels.length : labels.indexOf(prediction.label)]++;
        if (predictLegacy(baseline, example.text).label === example.label) baselineCorrect++;
      }
    }
    const correct = confusion.reduce((sum, row, index) => sum + row[index], 0), total = examples.length;
    const accepted = total - confusion.reduce((sum, row) => sum + row[labels.length], 0);
    const perLabel = labels.map((label, index) => {
      const support = confusion[index].reduce((a, b) => a + b, 0), predicted = confusion.reduce((sum, row) => sum + row[index], 0);
      const precision = predicted ? confusion[index][index] / predicted : 0, recall = confusion[index][index] / support;
      return { label, support, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
    });
    evaluation = { method: "stratified-3-fold", folds: 3, seed, labels, correct, total, accuracy: correct / total, accepted, coverage: accepted / total, selectiveAccuracy: accepted ? correct / accepted : null, candidateAccuracy: candidateCorrect / total, macroF1: perLabel.reduce((sum, item) => sum + item.f1, 0) / labels.length, perLabel, confusion, baseline: { name: "Naive Bayes v1", correct: baselineCorrect, accuracy: baselineCorrect / total } };
  }
  const model = fit(examples, name, epochs, duplicatesRemoved, onFit(canEvaluate ? 3 : 0));
  return { model, examples, evaluation };
}

export function validateHybrid(input: unknown): HybridModel {
  const model = input as HybridModel;
  // Reuse all v1 checks on count matrices, bounds, labels and vocabulary.
  if (!model || model.format !== "aegis-hybrid-text" || model.version !== 2) throw new Error("invalid_model");
  const finiteArray = (values: unknown, length: number, minimum: number, maximum: number): values is number[] => Array.isArray(values) && values.length === length && values.every(value => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
  if (!Array.isArray(model.vocabulary) || !Array.isArray(model.labels)) throw new Error("invalid_model");
  const width = model.vocabulary.length, height = model.labels.length;
  if (width < 1 || width > 4096 || height < 2 || height > 12 || model.sampleCount < 8) throw new Error("invalid_model");
  if (!model.vocabulary.every(token => typeof token === "string" && /^(?:w:|b:|c:).+/u.test(token) && token.length <= 163)) throw new Error("invalid_model");
  // Prefix length is stripped solely for the legacy bound check; uniqueness of
  // actual tokens is checked separately (w:abc and c:abc are different features).
  const fakeVocabulary = model.vocabulary.map((_, index) => `feature${index}`);
  validateLegacyShape({ ...model, format: "aegis-multinomial-nb", version: 1, vocabulary: fakeVocabulary });
  if (model.documentCounts.some(count => count < 2)) throw new Error("invalid_model");
  if (new Set(model.vocabulary).size !== width || !finiteArray(model.idf, width, 1, 8) || !finiteArray(model.bias, height, -100, 100) || !Array.isArray(model.weights) || model.weights.length !== height || !model.weights.every(row => finiteArray(row, width, -100, 100))) throw new Error("invalid_model");
  const training = model.training, decision = model.decision;
  if (!training || ![20, 40, 80].includes(training.epochs) || training.seed !== seed || training.learningRate !== 0.7 || training.regularization !== 0.0005 || training.charWeight !== 0.45 || training.linearBlend !== 0.85 || !finiteArray(training.loss, training.epochs, 0, 100) || !Number.isSafeInteger(training.duplicatesRemoved) || training.duplicatesRemoved < 0 || training.duplicatesRemoved + model.sampleCount > 500) throw new Error("invalid_model");
  if (!decision || decision.minScore !== 0.34 || decision.minMargin !== 0.08 || decision.minWordCoverage !== 0.18 || decision.minCharCoverage !== 0.60) throw new Error("invalid_model");
  return model;
}

