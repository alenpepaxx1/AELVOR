// Copyright © 2026 Alen Pepa
import { attributeCode } from "./copyright.ts";
export type TrainingExample = { label: string; text: string };
export type LocalModel = {
  format: "aegis-multinomial-nb";
  version: 1;
  name: string;
  createdAt: string;
  labels: string[];
  vocabulary: string[];
  documentCounts: number[];
  counts: number[][];
  tokenTotals: number[];
  sampleCount: number;
};
export type Evaluation = { correct: number; total: number; accuracy: number; method: "stratified-holdout" };
export type ModelBundle = { model: LocalModel; examples: TrainingExample[]; evaluation: Evaluation | null };
export type Prediction = { label: string | null; scores: { label: string; score: number }[]; knownFeatures: number; totalFeatures: number };

const stopWords = new Set("the a an is are to of and or for in on at with this that it be as from was were i you my your ein eine einer der die das und oder ist sind zu von im auf mit den dem des ich du mein bitte".split(" "));
const maxVocabulary = 4096;

export function features(text: string): Map<string, number> {
  const words = (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,40}/gu) || []).filter(word => !stopWords.has(word)).slice(0, 1200);
  const result = new Map<string, number>();
  const add = (word: string) => result.set(word, Math.min(3, (result.get(word) || 0) + 1));
  for (let index = 0; index < words.length; index++) {
    add(words[index]);
    if (index) add(`${words[index - 1]}~${words[index]}`);
  }
  return result;
}

export function validateExamples(input: unknown): TrainingExample[] {
  if (!Array.isArray(input) || input.length < 8 || input.length > 500) throw new Error("dataset_size");
  const examples: TrainingExample[] = input.map(value => {
    if (!value || typeof value !== "object" || typeof value.label !== "string" || typeof value.text !== "string") throw new Error("invalid_dataset");
    const label = value.label.trim();
    const text = value.text.trim();
    if (!/^[\p{L}\p{N}_ -]{1,32}$/u.test(label) || text.length < 4 || text.length > 2000 || features(text).size < 2) throw new Error("invalid_dataset");
    return { label, text };
  });
  const groups = new Map<string, number>();
  for (const example of examples) groups.set(example.label, (groups.get(example.label) || 0) + 1);
  if (groups.size < 2 || groups.size > 12 || [...groups.values()].some(count => count < 2)) throw new Error("dataset_labels");
  return examples;
}

export function fitLegacy(examples: TrainingExample[], name: string): LocalModel {
  const labels = [...new Set(examples.map(example => example.label))].sort();
  const frequencies = new Map<string, number>();
  const vectors = examples.map(example => {
    const vector = features(example.text);
    for (const [token, count] of vector) frequencies.set(token, (frequencies.get(token) || 0) + count);
    return vector;
  });
  const vocabulary = [...frequencies].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, maxVocabulary).map(([token]) => token);
  const indices = new Map(vocabulary.map((token, index) => [token, index]));
  const counts = labels.map(() => vocabulary.map(() => 0));
  const documentCounts = labels.map(() => 0);
  const tokenTotals = labels.map(() => 0);
  examples.forEach((example, index) => {
    const row = labels.indexOf(example.label); documentCounts[row]++;
    for (const [token, count] of vectors[index]) {
      const column = indices.get(token);
      if (column === undefined) continue;
      counts[row][column] += count; tokenTotals[row] += count;
    }
  });
  return { format: "aegis-multinomial-nb", version: 1, name: name.trim().slice(0, 60) || "AEGIS Local Classifier", createdAt: new Date().toISOString(), labels, vocabulary, documentCounts, counts, tokenTotals, sampleCount: examples.length };
}

export function predict(model: LocalModel, text: string): Prediction {
  if (text.length > 20000) throw new Error("input_too_long");
  const vector = features(text);
  const indices = new Map(model.vocabulary.map((token, index) => [token, index]));
  const known = [...vector].filter(([token]) => indices.has(token));
  if (!known.length) return { label: null, scores: [], knownFeatures: 0, totalFeatures: vector.size };
  const logs = model.labels.map((label, row) => {
    let score = Math.log((model.documentCounts[row] + 1) / (model.sampleCount + model.labels.length));
    const denominator = model.tokenTotals[row] + model.vocabulary.length;
    for (const [token, count] of known) score += count * Math.log((model.counts[row][indices.get(token)!] + 1) / denominator);
    return { label, log: score };
  });
  const max = Math.max(...logs.map(item => item.log));
  const denominator = logs.reduce((sum, item) => sum + Math.exp(item.log - max), 0);
  const scores = logs.map(item => ({ label: item.label, score: Math.exp(item.log - max) / denominator })).sort((a, b) => b.score - a.score);
  return { label: scores[0].label, scores, knownFeatures: known.length, totalFeatures: vector.size };
}

export function trainLocalModel(input: unknown, name = "AEGIS Local Classifier"): ModelBundle {
  const examples = validateExamples(input);
  const groups = new Map<string, TrainingExample[]>();
  for (const example of examples) groups.set(example.label, [...(groups.get(example.label) || []), example]);
  let evaluation: Evaluation | null = null;
  if (examples.length >= 16 && [...groups.values()].every(group => group.length >= 4)) {
    const train: TrainingExample[] = [], test: TrainingExample[] = [];
    for (const group of groups.values()) group.forEach((example, index) => (index % 4 === 0 ? test : train).push(example));
    const heldOutModel = fitLegacy(train, name);
    const correct = test.filter(example => predict(heldOutModel, example.text).label === example.label).length;
    evaluation = { correct, total: test.length, accuracy: correct / test.length, method: "stratified-holdout" };
  }
  return { model: fitLegacy(examples, name), examples, evaluation };
}

export function validateModel(input: unknown): LocalModel {
  const model = input as LocalModel;
  if (!model || model.format !== "aegis-multinomial-nb" || model.version !== 1 || typeof model.name !== "string" || model.name.length > 60 || typeof model.createdAt !== "string" || !Number.isFinite(Date.parse(model.createdAt))) throw new Error("invalid_model");
  if (!Array.isArray(model.labels) || model.labels.length < 2 || model.labels.length > 12 || !model.labels.every(label => typeof label === "string" && /^[\p{L}\p{N}_ -]{1,32}$/u.test(label)) || new Set(model.labels).size !== model.labels.length) throw new Error("invalid_model");
  if (!Array.isArray(model.vocabulary) || !model.vocabulary.length || model.vocabulary.length > maxVocabulary || !model.vocabulary.every(token => typeof token === "string" && token.length > 0 && token.length <= 81) || new Set(model.vocabulary).size !== model.vocabulary.length) throw new Error("invalid_model");
  if (!Number.isSafeInteger(model.sampleCount) || model.sampleCount < 2 || model.sampleCount > 500 || !Array.isArray(model.counts) || !Array.isArray(model.documentCounts) || !Array.isArray(model.tokenTotals)) throw new Error("invalid_model");
  if ([model.counts, model.documentCounts, model.tokenTotals].some(values => values.length !== model.labels.length)) throw new Error("invalid_model");
  if (model.documentCounts.some(count => !Number.isSafeInteger(count) || count < 1) || model.documentCounts.reduce((sum, count) => sum + count, 0) !== model.sampleCount) throw new Error("invalid_model");
  model.counts.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== model.vocabulary.length || row.some(count => !Number.isSafeInteger(count) || count < 0 || count > 1_000_000)) throw new Error("invalid_model");
    if (!Number.isSafeInteger(model.tokenTotals[index]) || model.tokenTotals[index] < 1 || row.reduce((sum, count) => sum + count, 0) !== model.tokenTotals[index]) throw new Error("invalid_model");
  });
  return model;
}

export function restoreBundle(input: unknown): ModelBundle {
  const value = input as ModelBundle;
  const model = validateModel(value?.model || input);
  if (value?.examples !== undefined && !Array.isArray(value.examples)) throw new Error("invalid_dataset");
  const examples = value?.examples?.length ? validateExamples(value.examples) : [];
  // Imported evaluation claims are deliberately discarded; evaluation can be recomputed by training.
  return { model, examples, evaluation: null };
}

export const starterExamples: TrainingExample[] = [
  ...[
    "Urgent email asks me to verify my account password through a link.",
    "Unexpected invoice attachment asks for payment and login credentials.",
    "An email impersonates the bank and threatens to suspend my account.",
    "The message requests a password reset on an unfamiliar sign-in page.",
    "A fake delivery email asks me to open an attachment and enter credentials.",
    "The sender address differs from the company and asks for urgent payment.",
    "Dringende E-Mail verlangt mein Passwort über einen unbekannten Link.",
    "Verdächtige Rechnung im Anhang fordert Zahlung und Zugangsdaten.",
    "Eine gefälschte Banknachricht droht mit der Sperrung des Kontos.",
    "Die Nachricht fordert eine Anmeldung auf einer fremden Webseite.",
    "Gefälschte Paket-E-Mail verlangt die Eingabe von Zugangsdaten.",
    "Unbekannter Absender drängt auf sofortige Überweisung und Linkklick.",
  ].map(text => ({ label: "phishing", text })),
  ...[
    "Failed password authentication repeated for an SSH login user.",
    "Many invalid login attempts originated from one source IP address.",
    "User successfully completed multifactor authentication and signed in.",
    "The identity provider revoked an expired sign-in session token.",
    "Account lockout followed repeated incorrect password attempts.",
    "Review authentication logs for unusual sign-in events and MFA resets.",
    "Mehrfach fehlgeschlagene SSH-Anmeldung mit falschem Passwort.",
    "Viele ungültige Anmeldeversuche von einer einzelnen Quell-IP-Adresse.",
    "Benutzer hat die Mehrfaktor-Authentifizierung erfolgreich abgeschlossen.",
    "Identitätsanbieter hat eine abgelaufene Sitzung widerrufen.",
    "Kontosperrung nach wiederholten falschen Passwort-Eingaben.",
    "Authentifizierungsprotokolle zeigen ungewöhnliche Anmeldeereignisse.",
  ].map(text => ({ label: "authentication", text })),
  ...[
    "SQL query concatenates untrusted input instead of binding parameters.",
    "Unescaped user input reaches innerHTML in the web application.",
    "The application disables TLS certificate verification for requests.",
    "A web response lacks secure cookie attributes for the session.",
    "Review the API endpoint for SQL injection and access control issues.",
    "The browser renders unsanitized HTML from a request parameter.",
    "SQL-Abfrage verknüpft Benutzereingaben statt Parameter zu binden.",
    "Ungeprüfte Benutzereingaben gelangen in innerHTML der Webanwendung.",
    "Die Anwendung deaktiviert die TLS-Zertifikatsprüfung.",
    "Webantwort setzt ein Sitzungscookie ohne sichere Attribute.",
    "API-Endpunkt auf SQL-Injection und Zugriffskontrolle prüfen.",
    "Browser rendert ungefiltertes HTML aus einem Anfrageparameter.",
  ].map(text => ({ label: "web_security", text })),
  ...[
    "Scheduled backup completed and the restore verification succeeded.",
    "The server maintenance window includes operating system updates.",
    "Monitoring reports normal service availability and stable disk usage.",
    "A deployment changed the application version during planned maintenance.",
    "The administrator updated the asset inventory and patch schedule.",
    "Create a recovery plan and document the backup retention process.",
    "Geplantes Backup und Wiederherstellungsprüfung wurden abgeschlossen.",
    "Serverwartung umfasst Updates des Betriebssystems und Neustarts.",
    "Überwachung meldet normale Verfügbarkeit und stabile Festplattennutzung.",
    "Bereitstellung ändert die Anwendungsversion während geplanter Wartung.",
    "Administrator aktualisiert das Inventar und den Patch-Zeitplan.",
    "Wiederherstellungsplan und Aufbewahrung von Sicherungen dokumentieren.",
  ].map(text => ({ label: "operations", text })),
];

export function createStarterBundle(): ModelBundle { return trainLocalModel(starterExamples); }

export const pythonModelRunner = attributeCode(`"""AELVOR local classifier runner. Standard-library Python; no network calls.
Usage: python aelvor_predict.py model.json "text to classify"
Scores are relative to configured classes, not calibrated safety probabilities.
"""
import collections
import json
import math
import re
import sys
import unicodedata

STOP = set(${JSON.stringify([...stopWords].join(" "))}.split())

def features(text):
    words = re.findall(r"[^\\W_]{2,40}", unicodedata.normalize("NFKC", text).lower())
    words = [word for word in words if word not in STOP][:1200]
    result = collections.Counter(words)
    result.update(a + "~" + b for a, b in zip(words, words[1:]))
    return {word: min(count, 3) for word, count in result.items()}

def predict(model, text):
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

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python aelvor_predict.py model.json 'text'")
    with open(sys.argv[1], encoding="utf-8") as source:
        model = json.load(source)
    if model.get("format") != "aegis-multinomial-nb" or model.get("version") != 1:
        raise SystemExit("Unsupported model format")
    print(json.dumps(predict(model, sys.argv[2]), ensure_ascii=False, indent=2))
`, "python");
