# Copyright © 2026 Alen Pepa
"""AELVOR local classifier runner. Standard-library Python; no network calls.
Usage: python aelvor_predict.py model.json "text to classify"
Scores are relative to configured classes, not calibrated safety probabilities.
"""
import collections
import json
import math
import re
import sys
import unicodedata

STOP = set("the a an is are to of and or for in on at with this that it be as from was were i you my your ein eine einer der die das und oder ist sind zu von im auf mit den dem des ich du mein bitte".split())

def features(text):
    words = re.findall(r"[^\W_]{2,40}", unicodedata.normalize("NFKC", text).lower())
    words = [word for word in words if word not in STOP][:1200]
    result = collections.Counter(words)
    result.update(a + "~" + b for a, b in zip(words, words[1:]))
    return {word: min(count, 3) for word, count in result.items()}

def predict_v1(model, text):
    indices = {word: index for index, word in enumerate(model["vocabulary"])}
    known = [(word, count) for word, count in features(text).items() if word in indices]
    if not known:
        return {"label": None, "scores": [], "knownFeatures": 0}
    logs = []
    for row, label in enumerate(model["labels"]):
        score = math.log((model["documentCounts"][row] + 1) / (model["sampleCount"] + len(model["labels"])))
        denominator = model["tokenTotals"][row] + len(model["vocabulary"])
        score += sum(count * math.log((model["counts"][row][indices[word]] + 1) / denominator) for word, count in known)
        logs.append((label, score))
    maximum = max(score for _, score in logs)
    denominator = sum(math.exp(score - maximum) for _, score in logs)
    scores = sorted(({"label": label, "score": math.exp(score - maximum) / denominator} for label, score in logs), key=lambda item: -item["score"])
    return {"label": scores[0]["label"], "scores": scores, "knownFeatures": len(known)}


def hybrid_features(text):
    words = re.findall(r"[^\W_]{2,40}", unicodedata.normalize("NFKC", text).lower())
    words = [word for word in words if word not in STOP][:1200]
    result = {}
    def add(token, cap):
        result[token] = min(cap, result.get(token, 0) + 1)
    for index, word in enumerate(words):
        add("w:" + word, 3)
        if index:
            add("b:" + words[index - 1] + "~" + word, 3)
        padded = "^" + word + "$"
        for size in (3, 4, 5):
            for start in range(len(padded) - size + 1):
                add("c:" + padded[start:start + size], 1)
    return result

def softmax(values):
    maximum = max(values)
    exps = [math.exp(value - maximum) for value in values]
    total = sum(exps)
    return [value / total for value in exps]

def predict_v2(model, text):
    raw = hybrid_features(text)
    indices = {token: index for index, token in enumerate(model["vocabulary"])}
    known = [(token, count) for token, count in raw.items() if token in indices]
    word_count = sum(token.startswith("w:") for token in raw)
    char_count = sum(token.startswith("c:") for token in raw)
    word_coverage = sum(token.startswith("w:") for token, _ in known) / word_count if word_count else 0
    char_coverage = sum(token.startswith("c:") for token, _ in known) / char_count if char_count else 0
    result = {"label": None, "candidate": None, "reason": "unknown-vocabulary", "scores": [], "knownFeatures": len(known), "totalFeatures": len(raw), "wordCoverage": word_coverage, "charCoverage": char_coverage, "margin": 0, "evidence": []}
    if not known:
        return result
    training = model["training"]
    vector = [(indices[token], (1 + math.log(count)) * model["idf"][indices[token]] * (training["charWeight"] if token.startswith("c:") else 1)) for token, count in known]
    norm = math.sqrt(sum(value * value for _, value in vector)) or 1
    vector = [(index, value / norm) for index, value in vector]
    linear = softmax([model["bias"][label] + sum(row[index] * value for index, value in vector) for label, row in enumerate(model["weights"])])
    weighted = [(indices[token], count * (training["charWeight"] if token.startswith("c:") else 1)) for token, count in known]
    weight_sum = sum(value for _, value in weighted) or 1
    nb = softmax([math.log((model["documentCounts"][label] + 1) / (model["sampleCount"] + len(model["labels"]))) + 8 * sum(value * math.log((model["counts"][label][index] + 1) / (model["tokenTotals"][label] + len(indices))) for index, value in weighted) / weight_sum for label in range(len(model["labels"]))])
    scores = sorted(({"label": label, "score": training["linearBlend"] * linear[index] + (1 - training["linearBlend"]) * nb[index]} for index, label in enumerate(model["labels"])), key=lambda item: (-item["score"], item["label"]))
    margin = scores[0]["score"] - scores[1]["score"]
    policy = model["decision"]
    covered = word_coverage >= policy["minWordCoverage"] or (char_coverage >= policy["minCharCoverage"] and len(known) >= 8)
    reason = "low-coverage" if not covered else "ambiguous" if scores[0]["score"] < policy["minScore"] or margin < policy["minMargin"] else "accepted"
    top = model["labels"].index(scores[0]["label"])
    runner_up = model["labels"].index(scores[1]["label"])
    evidence = [{"feature": model["vocabulary"][index], "contribution": value * (model["weights"][top][index] - model["weights"][runner_up][index])} for index, value in vector if not model["vocabulary"][index].startswith("c:")]
    evidence = sorted((item for item in evidence if item["contribution"] > 0), key=lambda item: -item["contribution"])[:6]
    result.update(label=scores[0]["label"] if reason == "accepted" else None, candidate=scores[0]["label"], reason=reason, scores=scores, margin=margin, evidence=evidence)
    return result

def predict(model, text):
    if len(text.encode("utf-16-le")) // 2 > 20000:
        raise ValueError("input_too_long")
    if model.get("format") == "aegis-hybrid-text" and model.get("version") == 2:
        return predict_v2(model, text)
    if model.get("format") == "aegis-multinomial-nb" and model.get("version") == 1:
        return predict_v1(model, text)
    raise ValueError("Unsupported model format")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python aelvor_predict.py model.json 'text'")
    with open(sys.argv[1], encoding="utf-8") as source:
        model = json.load(source)
    print(json.dumps(predict(model, sys.argv[2]), ensure_ascii=False, indent=2))
