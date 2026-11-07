// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createStarterBundle, isLegacyStarter, predict, pythonModelRunner, restoreBundle, starterExamples, trainLocalModel, validateModel } from "../lib/local-model.ts";
import { starterExamples as legacyExamples, trainLocalModel as trainLegacy } from "../lib/model-legacy.ts";

const starter = createStarterBundle();
const custom = [
  ...["apple pear orchard harvest", "fresh apple fruit orchard", "pear apple basket harvest", "orchard fruit pear picking"].map(text => ({ label: "fruit", text })),
  ...["truck bus engine highway", "highway truck vehicle driver", "bus engine traffic vehicle", "diesel truck highway traffic"].map(text => ({ label: "vehicle", text })),
];

test("v2 learns custom labels, changes decisions with labels, and lowers its measured training objective", () => {
  const { model } = trainLocalModel(custom, "My classifier");
  assert.equal(model.name, "My classifier");
  assert.equal(model.version, 2);
  assert.equal(predict(model, "apple harvest orchard").label, "fruit");
  assert.equal(predict(model, "truck engine highway").label, "vehicle");
  assert.ok(model.weights.some(row => row.some(value => value !== 0)));
  assert.ok(model.training.loss.at(-1) < model.training.loss[0]);
  const swapped = trainLocalModel(custom.map(item => ({ ...item, label: item.label === "fruit" ? "vehicle" : "fruit" })));
  assert.equal(predict(swapped.model, "apple harvest orchard").label, "vehicle");
});

test("character features transfer to misspelled words while unrelated and ambiguous inputs can be rejected", () => {
  const model = trainLocalModel(custom).model;
  assert.equal(predict(model, "orchards apples pears").label, "fruit");
  assert.equal(predict(starter.model, "phishng passwrd accunt email").label, "phishing");
  const unknown = predict(starter.model, "quasar zucchini trombone");
  assert.equal(unknown.label, null);
  assert.equal(unknown.reason, "low-coverage");
  assert.equal(predict(starter.model, "the and der die").reason, "unknown-vocabulary");
  assert.deepEqual(predict(starter.model, "the and der die").scores, []);
  const indifferent = structuredClone(starter.model);
  indifferent.weights.forEach(row => row.fill(0)); indifferent.bias.fill(0);
  indifferent.counts.forEach(row => row.fill(1)); indifferent.tokenTotals.fill(indifferent.vocabulary.length);
  const ambiguous = predict(indifferent, "password");
  assert.equal(ambiguous.reason, "ambiguous");
  assert.equal(ambiguous.label, null);
  assert.ok(ambiguous.scores.length === 8 && ambiguous.wordCoverage === 1);
});

test("training and stratified cross-validation are deterministic and account for every unique example", () => {
  const second = trainLocalModel([...starterExamples].reverse());
  assert.equal(starter.model.sampleCount, 96);
  assert.deepEqual(starter.model.documentCounts, Array(8).fill(12));
  assert.deepEqual(starter.model.weights, second.model.weights);
  assert.deepEqual(starter.evaluation, second.evaluation);
  const evaluation = starter.evaluation;
  assert.equal(evaluation.total, 96);
  assert.equal(evaluation.method, "stratified-3-fold");
  assert.equal(evaluation.correct, evaluation.confusion.reduce((sum, row, index) => sum + row[index], 0));
  assert.equal(evaluation.total, evaluation.confusion.flat().reduce((a, b) => a + b, 0));
  assert.equal(evaluation.accepted, evaluation.total - evaluation.confusion.reduce((sum, row) => sum + row[8], 0));
  assert.equal(evaluation.accuracy, evaluation.correct / evaluation.total);
  assert.equal(evaluation.selectiveAccuracy, evaluation.correct / evaluation.accepted);
  assert.equal(evaluation.coverage, evaluation.accepted / evaluation.total);
  assert.equal(evaluation.macroF1, evaluation.perLabel.reduce((sum, item) => sum + item.f1, 0) / 8);
  evaluation.perLabel.forEach((row, index) => {
    assert.equal(row.support, 12);
    assert.equal(row.recall, evaluation.confusion[index][index] / 12);
  });
  assert.equal(trainLocalModel(custom).evaluation, null);
});

test("normalized duplicates cannot inflate evaluation and conflicting labels are rejected", () => {
  const examples = [...starterExamples, { ...starterExamples[0], text: starterExamples[0].text.toUpperCase().replaceAll(" ", "  ") }];
  const deduplicated = trainLocalModel(examples);
  assert.equal(deduplicated.model.sampleCount, 96);
  assert.equal(deduplicated.model.training.duplicatesRemoved, 1);
  assert.deepEqual(deduplicated.evaluation, starter.evaluation);
  assert.throws(() => trainLocalModel([...starterExamples, { label: "authentication", text: starterExamples[0].text }]), /conflicting_labels/);
  assert.throws(() => trainLocalModel(Array.from({ length: 8 }, (_, index) => ({ label: index < 4 ? "a" : "b", text: index < 4 ? "one apple orchard" : "one engine truck" }))), /dataset_unique/);
});

test("untrusted model imports reject nonfinite weights, invalid policy, dimensions and forged metrics", () => {
  const model = starter.model;
  assert.equal(validateModel(JSON.parse(JSON.stringify(model))).sampleCount, 96);
  for (const mutate of [
    value => { value.counts[0][0] = -1; }, value => { value.counts.pop(); },
    value => { value.vocabulary[1] = value.vocabulary[0]; }, value => { value.weights[0][0] = Infinity; },
    value => { value.idf[0] = NaN; }, value => { value.bias.pop(); }, value => { value.decision.minScore = -1; },
    value => { value.training.loss = [0]; },
  ]) { const bad = structuredClone(model); mutate(bad); assert.throws(() => validateModel(bad), /invalid_model/); }
  assert.throws(() => trainLocalModel([]), /dataset_size/);
  assert.throws(() => trainLocalModel(starterExamples.map(item => ({ ...item, label: "one_label" }))), /dataset_labels/);
  assert.throws(() => trainLocalModel(custom, "", { epochs: 100000 }), /invalid_training_options/);
  assert.throws(() => predict(model, "a".repeat(20001)), /input_too_long/);
  const imported = restoreBundle({ model, examples: starterExamples, evaluation: { correct: 9999, total: 9999, accuracy: 1 } });
  assert.equal(imported.evaluation, null);
  assert.deepEqual(restoreBundle(JSON.parse(JSON.stringify(restoreBundle(model)))).examples, []);
});

test("predictions expose positive learned evidence and normalized relative scores", () => {
  const result = predict(starter.model, "urgent email asks for account password");
  assert.equal(result.label, "phishing");
  assert.ok(result.evidence.some(item => item.feature.includes("email")));
  assert.ok(result.evidence.every(item => item.contribution > 0 && !item.feature.startsWith("c:")));
  assert.ok(Math.abs(result.scores.reduce((sum, item) => sum + item.score, 0) - 1) < 1e-12);
});

test("training reports actual fold and epoch progress for the selected budget", () => {
  const progress = [];
  const bundle = trainLocalModel(custom, "Budget", { epochs: 20, onProgress: value => progress.push(value) });
  assert.equal(bundle.model.training.epochs, 20);
  assert.equal(bundle.model.training.loss.length, 20);
  assert.equal(progress[0].phase, "validation");
  assert.equal(progress.at(-1).progress, 1);
  assert.equal(progress.at(-1).loss, bundle.model.training.loss.at(-1));
  assert.equal(progress.at(-1).epoch, 20);
});

test("exported Python inference agrees with JS for both formats, German, misspellings and rejection", () => {
  const folder = mkdtempSync(join(tmpdir(), "aegis-model-"));
  try {
    const runner = join(folder, "aegis_predict.py"), file = join(folder, "model.json");
    writeFileSync(runner, pythonModelRunner);
    const legacy = validateModel(JSON.parse(readFileSync(new URL("../public/models/aegis-local-classifier-v1.json", import.meta.url), "utf8")));
    for (const model of [starter.model, legacy]) {
      writeFileSync(file, JSON.stringify(model));
      for (const text of ["urgent email asks for my password", "Mehrfach fehlgeschlagene SSH-Anmeldung mit falschem Passwort", "phishng passwrd accunt email", "quasar zucchini trombone", "the and der die", "Cloud-Speicher erlaubt öffentlichen Lesezugriff"]) {
        const response = spawnSync("python3", [runner, file, text], { encoding: "utf8" });
        assert.equal(response.status, 0, response.stderr);
        const actual = JSON.parse(response.stdout), expected = predict(model, text);
        assert.equal(actual.label, expected.label, text);
        assert.equal(actual.knownFeatures, expected.knownFeatures, text);
        assert.equal(actual.scores.length, expected.scores.length);
        if (model.version === 2) { assert.equal(actual.reason, expected.reason); assert.equal(actual.candidate, expected.candidate); }
        for (let index = 0; index < expected.scores.length; index++) {
          assert.equal(actual.scores[index].label, expected.scores[index].label);
          assert.ok(Math.abs(actual.scores[index].score - expected.scores[index].score) < 1e-10);
        }
        if (model.version === 2) {
          assert.deepEqual(actual.evidence.map(item => item.feature), expected.evidence.map(item => item.feature));
          actual.evidence.forEach((item, index) => assert.ok(Math.abs(item.contribution - expected.evidence[index].contribution) < 1e-10));
        }
      }
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("versioned public artifacts validate and only the unchanged legacy starter qualifies for automatic upgrade", () => {
  const legacy = validateModel(JSON.parse(readFileSync(new URL("../public/models/aegis-local-classifier-v1.json", import.meta.url), "utf8")));
  const current = validateModel(JSON.parse(readFileSync(new URL("../public/models/aegis-local-classifier-v2.json", import.meta.url), "utf8")));
  assert.equal(legacy.sampleCount, 48); assert.equal(current.sampleCount, 96);
  assert.deepEqual(current.weights, starter.model.weights);
  assert.equal(predict(legacy, "failed SSH password authentication login").label, "authentication");
  assert.equal(isLegacyStarter({ model: legacy, examples: legacyExamples, evaluation: null }), true);
  assert.equal(isLegacyStarter({ model: legacy, examples: [], evaluation: null }), false);
  const altered = structuredClone(legacy); altered.counts[0][0]++; altered.tokenTotals[0]++;
  assert.equal(isLegacyStarter({ model: altered, examples: legacyExamples, evaluation: null }), false);
  const repeated = [...Array.from({ length: 4 }, () => ({ label: "fruit", text: "apple pear orchard" })), ...Array.from({ length: 4 }, () => ({ label: "vehicle", text: "truck engine highway" }))];
  const customLegacy = trainLegacy(repeated, "My legacy model");
  assert.equal(restoreBundle(customLegacy).model.name, "My legacy model");
  assert.equal(restoreBundle(customLegacy).examples.length, 8);
  assert.equal(isLegacyStarter({ model: legacy, examples: legacyExamples.map((example, index) => index ? example : { ...example, text: "My custom corpus" }), evaluation: null }), false);
});
