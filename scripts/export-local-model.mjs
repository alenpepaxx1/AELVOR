// Copyright © 2026 Alen Pepa
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createStarterBundle, pythonModelRunner } from "../lib/local-model.ts";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";

const bundle = createStarterBundle();
mkdirSync("public/models", { recursive: true });
const exports = {
  "local-classifier-v2.json": JSON.stringify({ ...bundle.model, copyright: COPYRIGHT_NOTICE }, null, 2),
  "training-data.json": JSON.stringify(bundle.examples, null, 2),
  "evaluation-v2.json": JSON.stringify({ ...bundle.evaluation, copyright: COPYRIGHT_NOTICE }, null, 2),
};
for (const [name, content] of Object.entries(exports)) {
  // Keep the previously published download paths working after the rename.
  for (const prefix of ["aelvor", "nyqal", "aegis"]) writeFileSync(`public/models/${prefix}-${name}`, content);
}
for (const prefix of ["aelvor", "nyqal", "aegis"]) writeFileSync(`public/models/${prefix}_predict.py`, pythonModelRunner);
copyFileSync("COPYRIGHT", "public/COPYRIGHT.txt");
copyFileSync("COPYRIGHT", "public/models/COPYRIGHT.txt");
writeFileSync("public/models/MODEL_CARD.md", `# AELVOR Hybrid v2

${COPYRIGHT_NOTICE}

A trained, specialized bilingual text classifier. It does not generate general conversation or code. The Local tools mode supplies supported tools, fixed script templates and knowledge notes. AELVOR also has a separate optional general conversation mode using a downloaded, pretrained language model selected from the model library; classifier training does not train that model.

## Architecture and reproducibility

- ${bundle.model.sampleCount} authored English/German teaching examples; no user conversations used.
- ${bundle.model.labels.length} topic classes: ${bundle.model.labels.join(", ")}.
- ${bundle.model.vocabulary.length} learned features: word unigrams and adjacent bigrams (counts capped at 3); word-boundary character 3–5-grams (presence, document frequency at least 2).
- Vocabulary cap: 4,096, with up to 2,048 features per representation. Vocabulary and IDF are learned independently inside each training fold.
- TF-IDF: (1 + ln(tf)) × (1 + ln((1 + N)/(1 + document frequency))); character multiplier ${bundle.model.training.charWeight}; L2-normalized sparse input vectors.
- Class-balanced multinomial softmax learned by seeded stochastic gradient descent; L2 penalty ${bundle.model.training.regularization}; initial learning rate ${bundle.model.training.learningRate}, reduced by sqrt(1 + epoch/8); ${bundle.model.training.epochs} epochs, seed ${bundle.model.training.seed}.
- An ensemble mixes ${bundle.model.training.linearBlend * 100}% linear softmax scores and ${(100 - bundle.model.training.linearBlend * 100).toFixed(0)}% length-normalized Naive Bayes scores. NB uses add-one smoothing and evidence scale 8. These scores are uncalibrated.
- Float weights, IDF and bias are rounded to 8 decimal places before evaluation and export. The standard-library Python runner mirrors inference.
- Final regularized training objective: ${bundle.model.training.loss[0]} → ${bundle.model.training.loss.at(-1)}. Training loss does not establish generalization.

## Abstention policy

A label is returned only when word overlap is at least ${bundle.model.decision.minWordCoverage}, OR character overlap is at least ${bundle.model.decision.minCharCoverage} with 8 known features; the highest score must be at least ${bundle.model.decision.minScore} and exceed the runner-up by at least ${bundle.model.decision.minMargin}. Otherwise a diagnostic candidate may be returned with a null accepted label. These fixed heuristic thresholds are not calibrated guarantees and can still accept out-of-domain text.

Explanations show positive word/bigram contributions to the top-versus-runner-up logit difference in the linear branch. They do not explain the entire ensemble and are not causal evidence.

## Measured development-corpus evaluation

Seeded stratified 3-fold cross-validation. Every unique example is tested exactly once by a model that did not train on that example. Identical normalized texts are deduplicated before splitting; conflicting labels are rejected. Similar paraphrases and translations can remain in separate folds, so these are optimistic development diagnostics, not an independent benchmark. Hyperparameters and vocabulary are not fitted on each test fold. No test-fold calibration is performed.

- Overall accuracy, counting rejections as incorrect: ${bundle.evaluation.correct}/${bundle.evaluation.total} = ${(bundle.evaluation.accuracy * 100).toFixed(2)}%.
- Accepted texts: ${bundle.evaluation.accepted}/${bundle.evaluation.total}; coverage ${(bundle.evaluation.coverage * 100).toFixed(2)}%.
- Correct among accepted texts: ${(bundle.evaluation.selectiveAccuracy * 100).toFixed(2)}%.
- Top candidate accuracy before abstention: ${(bundle.evaluation.candidateAccuracy * 100).toFixed(2)}%.
- Macro F1, including rejection false negatives: ${bundle.evaluation.macroF1.toFixed(4)}.
- Naive Bayes v1 on the SAME folds: ${bundle.evaluation.baseline.correct}/${bundle.evaluation.total} = ${(bundle.evaluation.baseline.accuracy * 100).toFixed(2)}%. v1 does not have the v2 abstention policy; overall accepted accuracy is not directly comparable.

Full confusion matrix and per-class precision/recall/F1: aelvor-evaluation-v2.json. Columns follow the labels array, with a final column for rejected predictions. The final exported model is then refit on ALL ${bundle.model.sampleCount} unique examples.

This small authored corpus is not representative of production data. These measurements do not prove real-world accuracy or superiority. Topic labels do not determine whether a message is safe or malicious. Validate on independent, representative data before relying on a model.

## Use and limits

Training: 8–500 unique examples, 2–12 labels, at least two examples per class; 4–2,000 characters per example. Evaluation requires at least 16 unique examples and four per class. Inference input limit: 20,000 UTF-16 code units. Training runs in a cancellable browser worker with 20/40/80 epochs. Cancelling preserves the previous model.

    python aelvor_predict.py aelvor-local-classifier-v2.json "urgent email asks for my password"

The runner also supports the preserved v1 JSON artifact. Previously published download paths and model format identifiers remain compatible. Model-lab backups include editable examples and weights; imported/restored evaluation claims are discarded and can be recomputed by training. Existing custom v1 weights are preserved until explicitly retrained. The bundled v1 starter is upgraded to v2; its old storage key is retained.

No external model service or API key is required. The hosted app requires an initial connection and ChatGPT sign-in; worker modules are same-origin application assets. Browser voice services may use their own network connection. This is not a fully offline install.

## Method references

- https://scikit-learn.org/stable/modules/feature_extraction.html
- https://scikit-learn.org/stable/modules/linear_model.html#logistic-regression
- https://scikit-learn.org/stable/modules/cross_validation.html
- https://nlp.stanford.edu/IR-book/html/htmledition/naive-bayes-text-classification-1.html

Implementation is dependency-free TypeScript, with a matching Python inference export; it does not use scikit-learn at runtime.
`);
console.log(JSON.stringify({ samples: bundle.model.sampleCount, labels: bundle.model.labels.length, features: bundle.model.vocabulary.length, evaluation: bundle.evaluation }));
