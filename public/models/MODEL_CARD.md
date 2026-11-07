# AELVOR Hybrid v2

Copyright © 2026 Alen Pepa

A trained, specialized bilingual text classifier. It does not generate general conversation or code. The Local tools mode supplies supported tools, fixed script templates and knowledge notes. AELVOR also has a separate optional general conversation mode using a downloaded, pretrained language model selected from the model library; classifier training does not train that model.

## Architecture and reproducibility

- 96 authored English/German teaching examples; no user conversations used.
- 8 topic classes: authentication, cloud_security, data_protection, malware_analysis, network_security, operations, phishing, web_security.
- 3115 learned features: word unigrams and adjacent bigrams (counts capped at 3); word-boundary character 3–5-grams (presence, document frequency at least 2).
- Vocabulary cap: 4,096, with up to 2,048 features per representation. Vocabulary and IDF are learned independently inside each training fold.
- TF-IDF: (1 + ln(tf)) × (1 + ln((1 + N)/(1 + document frequency))); character multiplier 0.45; L2-normalized sparse input vectors.
- Class-balanced multinomial softmax learned by seeded stochastic gradient descent; L2 penalty 0.0005; initial learning rate 0.7, reduced by sqrt(1 + epoch/8); 40 epochs, seed 173.
- An ensemble mixes 85% linear softmax scores and 15% length-normalized Naive Bayes scores. NB uses add-one smoothing and evidence scale 8. These scores are uncalibrated.
- Float weights, IDF and bias are rounded to 8 decimal places before evaluation and export. The standard-library Python runner mirrors inference.
- Final regularized training objective: 1.333787 → 0.36798536. Training loss does not establish generalization.

## Abstention policy

A label is returned only when word overlap is at least 0.18, OR character overlap is at least 0.6 with 8 known features; the highest score must be at least 0.34 and exceed the runner-up by at least 0.08. Otherwise a diagnostic candidate may be returned with a null accepted label. These fixed heuristic thresholds are not calibrated guarantees and can still accept out-of-domain text.

Explanations show positive word/bigram contributions to the top-versus-runner-up logit difference in the linear branch. They do not explain the entire ensemble and are not causal evidence.

## Measured development-corpus evaluation

Seeded stratified 3-fold cross-validation. Every unique example is tested exactly once by a model that did not train on that example. Identical normalized texts are deduplicated before splitting; conflicting labels are rejected. Similar paraphrases and translations can remain in separate folds, so these are optimistic development diagnostics, not an independent benchmark. Hyperparameters and vocabulary are not fitted on each test fold. No test-fold calibration is performed.

- Overall accuracy, counting rejections as incorrect: 43/96 = 44.79%.
- Accepted texts: 50/96; coverage 52.08%.
- Correct among accepted texts: 86.00%.
- Top candidate accuracy before abstention: 77.08%.
- Macro F1, including rejection false negatives: 0.5735.
- Naive Bayes v1 on the SAME folds: 64/96 = 66.67%. v1 does not have the v2 abstention policy; overall accepted accuracy is not directly comparable.

Full confusion matrix and per-class precision/recall/F1: aelvor-evaluation-v2.json. Columns follow the labels array, with a final column for rejected predictions. The final exported model is then refit on ALL 96 unique examples.

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
