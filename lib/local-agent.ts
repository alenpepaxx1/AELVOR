// Copyright © 2026 Alen Pepa
import { assistantReplyLocale } from "./assistant-language.ts";
import { isDocumentFile, isDocumentSummary, localDocumentReply } from "./local-documents.ts";
import type { AssistantPreferences } from "./assistant-preferences.ts";
import type { KnowledgeDocument, KnowledgeExcerpt } from "./knowledge-library.ts";
import { arithmeticQuestion } from "./local-arithmetic.ts";
import { attributeCode } from "./copyright.ts";
import { exampleResponse, type Locale, type AgentMode } from "./templates.ts";
import { extractIndicators, formatJson, hashSha256, inspectUrl, type UrlSignal } from "./local-tools.ts";
import { createStarterBundle, predict, starterExamples, trainLocalModel, type ModelBundle } from "./local-model.ts";
import { createProjectScaffold, requestedProjectTarget, scaffoldMarkdown } from "./project-scaffolds.ts";

type FileExcerpt = { name: string; content: string; truncated?: boolean };
export type LocalAgentRequest = { text: string; locale: Locale; mode?: AgentMode; files?: FileExcerpt[]; history?: { role: string; content: string; attachments?: FileExcerpt[]; demo?: boolean; error?: boolean; stopped?: boolean }[]; knowledge?: KnowledgeDocument[]; preferences?: AssistantPreferences; bundle?: ModelBundle; signal?: AbortSignal; train?: (examples: unknown, name?: string) => Promise<ModelBundle> };
export type LocalAgentResult = { text: string; steps: string[]; kind: "analysis" | "knowledge" | "script" | "model" | "help" | "project"; bundle?: ModelBundle; language?: Locale; knowledge?: KnowledgeExcerpt[] };
export type CodeFinding = { line: number; rule: string; title: string; guidance: string };

const clean = (text: string) => text.replace(/[\n\r`|]/g, " ").slice(0, 120);
const choose = (locale: Locale, en: string, de: string) => locale === "de" ? de : en;
const block = (text: string, language: string) => `\`\`\`${language}\n${attributeCode(text, language)}\n\`\`\``;
const extractBlock = (text: string) => /```[^\n]*\n([\s\S]*?)(?:```|$)/.exec(text)?.[1]?.trim();
const sqlSource = "https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet";

export function inspectCode(code: string, locale: Locale): CodeFinding[] {
  const definitions: { rule: string; expression: RegExp; en: [string, string]; de: [string, string] }[] = [
    { rule: "sql-concatenation", expression: /(?:\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*(?:\+|\$\{|\{[a-z_]|\.format\s*\(|%\s*[a-z_(]))|(?:[fF]["'].*\b(?:SELECT|INSERT|UPDATE|DELETE)\b.*\{)/i, en: ["SQL built with interpolation or concatenation", "Bind values with your database driver's parameter API. Review the complete query and data flow."], de: ["SQL mit Interpolation oder Verkettung", "Binde Werte über die Parameter-API des Datenbanktreibers. Prüfe die vollständige Abfrage und den Datenfluss."] },
    { rule: "dynamic-execution", expression: /\b(?:eval|exec)\s*\(/, en: ["Dynamic code execution", "Avoid executing untrusted text. Prefer a parser and an explicit allowlist of operations."], de: ["Dynamische Code-Ausführung", "Führe keinen nicht vertrauenswürdigen Text aus. Nutze einen Parser und explizit erlaubte Operationen."] },
    { rule: "shell", expression: /\bshell\s*=\s*True\b|\bexecSync\s*\(|\bos\.system\s*\(/, en: ["Shell execution interface", "Trace whether external input reaches this operation. Prefer argument arrays without a shell."], de: ["Schnittstelle zur Shell-Ausführung", "Prüfe, ob externe Eingaben diese Operation erreichen. Bevorzuge Argumentlisten ohne Shell."] },
    { rule: "tls-verification", expression: /\bverify\s*=\s*False\b|\brejectUnauthorized\s*:\s*false\b/, en: ["Certificate verification disabled", "Restore certificate validation and configure the correct trust store."], de: ["Zertifikatsprüfung deaktiviert", "Aktiviere die Zertifikatsprüfung und konfiguriere den richtigen Vertrauensspeicher."] },
    { rule: "html-sink", expression: /\.innerHTML\s*=|dangerouslySetInnerHTML/, en: ["HTML rendering sink", "Check for untrusted data. Prefer text rendering or a suitable HTML sanitizer."], de: ["HTML-Ausgabestelle", "Prüfe nicht vertrauenswürdige Daten. Nutze Textausgabe oder eine geeignete HTML-Bereinigung."] },
    { rule: "embedded-secret", expression: /\b(?:password|api_key|apikey|secret|access_token)\s*[:=]\s*["'][^"'\n]{6,}["']/i, en: ["Possible embedded secret", "Review the value without copying it into reports. Move real secrets to protected configuration and rotate exposed credentials."], de: ["Möglicherweise eingebettetes Geheimnis", "Prüfe den Wert, ohne ihn in Berichte zu kopieren. Nutze geschützte Konfiguration und ersetze offengelegte Zugangsdaten."] },
    { rule: "weak-digest", expression: /\b(?:md5|sha1)\s*\(/i, en: ["Legacy digest function", "Review its purpose. A general file checksum and password storage have different requirements."], de: ["Ältere Hashfunktion", "Prüfe den Einsatzzweck. Dateiprüfsummen und Passwortspeicherung haben unterschiedliche Anforderungen."] },
  ];
  const findings: CodeFinding[] = [];
  code.slice(0, 40000).split("\n").forEach((line, index) => {
    if (/^\s*(?:#|\/\/|\*)/.test(line)) return;
    for (const definition of definitions) if (definition.expression.test(line) && findings.length < 40) {
      const [title, guidance] = locale === "de" ? definition.de : definition.en;
      findings.push({ line: index + 1, rule: definition.rule, title, guidance });
    }
  });
  return findings;
}

function codeReport(code: string, name: string, locale: Locale): string {
  const t = (en: string, de: string) => choose(locale, en, de);
  const findings = inspectCode(code, locale);
  let output = `## ${t("Local code review", "Lokales Code-Review")}\n**${clean(name)}** · ${code.split("\n").length} ${t("lines supplied", "übergebene Zeilen")} · ${findings.length} ${t("review signals", "Prüfhinweise")}\n\n`;
  if (!findings.length) output += t("No supported patterns matched. This does not establish that the code is secure; control flow, dependencies, authorization, and runtime behavior are outside this check.", "Keine unterstützten Muster gefunden. Das belegt nicht, dass der Code sicher ist; Kontrollfluss, Abhängigkeiten, Berechtigungen und Laufzeitverhalten werden hier nicht vollständig geprüft.");
  for (const finding of findings) output += `### ${t("Line", "Zeile")} ${finding.line}: ${finding.title}\n${finding.guidance}\n\n`;
  if (findings.some(finding => finding.rule === "sql-concatenation")) output += `### ${t("Example: parameter binding with Python sqlite3", "Beispiel: Parameterbindung mit Python sqlite3")}\n${block('cursor.execute("SELECT id FROM users WHERE name = ?", (username,))\nuser = cursor.fetchone()', "python")}\n[OWASP: Query parameterization](${sqlSource})\n\n`;
  return `${output}\n\n${t("Scope: line-based heuristic review. Source code was read as text and was not executed. Findings require contextual review.", "Umfang: zeilenbasierte heuristische Prüfung. Quellcode wurde als Text gelesen und nicht ausgeführt. Hinweise müssen im Kontext geprüft werden.")}`;
}

export function analyzeLogs(text: string) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const indicators = extractIndicators(text.slice(0, 100000));
  const failedAuth = lines.filter(line => /failed password|authentication fail|invalid user|login fail|anmeldung fehl|auth.*fail/i.test(line)).length;
  const blocked = lines.filter(line => /\b(blocked|denied|abgelehnt|blockiert)\b/i.test(line)).length;
  const errors = lines.filter(line => /\b(error|exception|fatal|fehler)\b/i.test(line)).length;
  const counts = new Map<string, number>();
  for (const line of lines) for (const ip of line.match(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g) || []) if (indicators.ipv4.includes(ip)) counts.set(ip, (counts.get(ip) || 0) + 1);
  return { lines: lines.length, failedAuth, blocked, errors, indicators, topIps: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

function logReport(text: string, name: string, locale: Locale, bundle?: ModelBundle): string {
  const t = (en: string, de: string) => choose(locale, en, de);
  const result = analyzeLogs(text);
  let output = `## ${t("Local log analysis", "Lokale Log-Analyse")}\n**${clean(name)}**\n\n| ${t("Observed metric", "Beobachtete Kennzahl")} | ${t("Count", "Anzahl")} |\n| --- | --- |\n| ${t("Non-empty lines", "Nicht leere Zeilen")} | ${result.lines} |\n| ${t("Failed-authentication lines", "Zeilen mit fehlgeschlagener Anmeldung")} | ${result.failedAuth} |\n| ${t("Blocked/denied lines", "Blockierte/abgelehnte Zeilen")} | ${result.blocked} |\n| ${t("Error/exception lines", "Fehler-/Exception-Zeilen")} | ${result.errors} |\n| ${t("Unique IPv4 candidates", "Eindeutige IPv4-Kandidaten")} | ${result.indicators.ipv4.length} |\n`;
  if (result.topIps.length) output += `\n### ${t("Most frequent IP candidates", "Häufigste IP-Kandidaten")}\n${result.topIps.map(([ip, count]) => `- ${ip}: ${count} ${t("occurrences", "Vorkommen")}`).join("\n")}\n`;
  if (result.failedAuth > 0) output += `\n### ${t("Suggested follow-up", "Nächste Prüfschritte")}\n${t("- Correlate timestamps and user accounts with the original authentication source.\n- Check whether repeated failures were followed by a successful sign-in.\n- Compare activity against your expected baseline before deciding on containment.", "- Zeitstempel und Benutzerkonten mit der ursprünglichen Authentifizierungsquelle abgleichen.\n- Prüfen, ob auf wiederholte Fehler eine erfolgreiche Anmeldung folgte.\n- Aktivität mit dem erwarteten Normalverhalten vergleichen, bevor Eindämmungsmaßnahmen beschlossen werden.")}\n`;
  if (bundle) { const prediction = predict(bundle.model, text.slice(0, 20000)); if (prediction.label && prediction.knownFeatures >= 3) output += `\n${t("Local model topic candidate", "Themenkandidat des lokalen Modells")}: **${clean(prediction.label)}**. ${t("A topic label is not a threat verdict.", "Eine Themenklasse ist kein Bedrohungsurteil.")}\n`; }
  return `${output}\n${t("Scope: patterns and counts in the supplied text only. No system, IP address, or live service was accessed.", "Umfang: Muster und Zählungen ausschließlich im übergebenen Text. Kein System, keine IP-Adresse und kein Live-Dienst wurden aufgerufen.")}`;
}

function rawScript(kind: "hash" | "logs" | "inventory"): string {
  if (kind === "hash") return /```python\n([\s\S]*?)```/.exec(exampleResponse("script", "en"))![1].trim();
  if (kind === "logs") return `import argparse
import collections
import ipaddress
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description="Read a log and count IPv4 candidates")
parser.add_argument("file", type=Path)
args = parser.parse_args()
counts = collections.Counter()
line_count = 0
try:
    with args.file.open(encoding="utf-8", errors="replace") as source:
        for line in source:
            line_count += 1
            for value in re.findall(r"(?<![\\w.])(?:\\d{1,3}\\.){3}\\d{1,3}(?![\\w.])", line):
                try:
                    ipaddress.IPv4Address(value)
                    counts[value] += 1
                except ValueError:
                    pass
    print(json.dumps({"lines": line_count, "ipv4_candidates": counts.most_common(100)}, indent=2))
except OSError as error:
    parser.exit(1, f"Error: {error}\\n")`;
  return `import argparse
import csv
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description="Read-only file inventory; no symlink traversal")
parser.add_argument("directory", type=Path)
parser.add_argument("--limit", type=int, default=10000)
args = parser.parse_args()
if not args.directory.is_dir() or not 1 <= args.limit <= 100000:
    parser.error("Use an existing directory and a limit between 1 and 100000")
root = args.directory.resolve()
writer = csv.writer(sys.stdout)
writer.writerow(["relative_path", "size_bytes", "modified_unix"])
count = 0
for current, directories, files in os.walk(root, followlinks=False):
    directories[:] = sorted(name for name in directories if not Path(current, name).is_symlink())
    for name in sorted(files):
        path = Path(current, name)
        if path.is_symlink():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        relative = str(path.relative_to(root))
        if relative.lstrip()[:1] in ("=", "+", "-", "@"):
            relative = "\'" + relative
        writer.writerow([relative, stat.st_size, int(stat.st_mtime)])
        count += 1
        if count >= args.limit:
            raise SystemExit(0)`;
}

function knowledge(text: string, locale: Locale): string | null {
  const t = (en: string, de: string) => choose(locale, en, de);
  if (/zero[ -]?trust|nullvertrauen/i.test(text)) return exampleResponse("learn", locale);
  if (/phishing|phish|incident response|vorfallreaktion/i.test(text)) return exampleResponse("incident", locale);
  if (/sql[ -]?inject|\bsqli\b/i.test(text)) return t(`## SQL injection\nSQL injection happens when input changes the structure of a database query. Keep values separate from SQL syntax through server-side parameter binding.\n\n### Python sqlite3 example\n${block('cursor.execute("SELECT id FROM users WHERE name = ?", (username,))', "python")}\nThe placeholder syntax depends on the database driver. Authorization and database privileges still need their own controls.\n\n[OWASP: Query parameterization](${sqlSource})`, `## SQL-Injection\nSQL-Injection entsteht, wenn Eingaben die Struktur einer Datenbankabfrage verändern. Trenne Werte durch serverseitige Parameterbindung von der SQL-Syntax.\n\n### Beispiel mit Python sqlite3\n${block('cursor.execute("SELECT id FROM users WHERE name = ?", (username,))', "python")}\nDie Platzhalter-Syntax hängt vom Datenbanktreiber ab. Berechtigungsprüfungen und Datenbankrechte benötigen eigene Kontrollen.\n\n[OWASP: Query parameterization](${sqlSource})`);
  if (/\bmfa\b|multi.?factor|mehrfaktor|two.factor|2fa/i.test(text)) return t("## Multifactor authentication\nMFA combines different types of authentication evidence, such as a password and a cryptographic authenticator. Two passwords are not two independent factors.\n\n- Prefer phishing-resistant authentication when your service supports it.\n- Protect enrollment, recovery, and administrator accounts.\n- Keep recovery methods secure and review sign-in activity.\n\nThis is a local knowledge note, not a check of your account configuration.", "## Mehrfaktor-Authentifizierung\nMFA kombiniert unterschiedliche Arten von Nachweisen, etwa ein Passwort und einen kryptografischen Authentifikator. Zwei Passwörter sind keine zwei unabhängigen Faktoren.\n\n- Wenn unterstützt, phishingresistente Anmeldung bevorzugen.\n- Registrierung, Wiederherstellung und Administratorkonten absichern.\n- Wiederherstellungswege schützen und Anmeldeaktivität prüfen.\n\nDies ist eine lokale Wissensnotiz, keine Prüfung deiner Kontoeinstellungen.");
  if (/least privilege|minimal.*recht|geringste.*recht/i.test(text)) return t("## Least privilege\nGive each identity only the access needed for its current task. Separate administrative and daily-use accounts, scope service identities, review access periodically, and remove unnecessary permissions.\n\nStart by listing an application's required operations, then test a narrower role before applying it in production.", "## Minimale Berechtigungen\nJede Identität erhält nur den Zugriff, den sie für ihre aktuelle Aufgabe benötigt. Administrative und tägliche Konten trennen, Dienstidentitäten eingrenzen, Zugriffe regelmäßig prüfen und unnötige Rechte entfernen.\n\nZuerst benötigte Operationen einer Anwendung erfassen und eine engere Rolle vor dem Produktiveinsatz testen.");
  if (/sha.?256|\bhash(?:ing)?\b|prüfsumme/i.test(text)) return t("## SHA-256 and integrity\nSHA-256 maps input bytes to a 256-bit digest. Compare a file's digest with a reference from a trusted source to check that the bytes match.\n\nA matching hash alone does not prove a file is harmless or establish who produced it. Use the Security lab's file fingerprint tool to hash the original file, rather than a pasted excerpt.", "## SHA-256 und Integrität\nSHA-256 bildet Eingabebytes auf einen 256-Bit-Hashwert ab. Vergleiche den Datei-Hash mit einer Referenz aus einer vertrauenswürdigen Quelle, um gleiche Bytes zu prüfen.\n\nEin übereinstimmender Hash allein beweist weder Ungefährlichkeit noch Herkunft. Nutze den Datei-Fingerabdruck im Security-Lab für die Originaldatei statt eines eingefügten Auszugs.");
  if (/naive bayes|naïve bayes|klassifikator|classifier|machine learning|maschinell.*lern/i.test(text)) return t("## Your local learning model\nAELVOR Hybrid v2 combines a TF-IDF softmax classifier with Naive Bayes evidence. It learns word, word-pair, and character features from labeled examples. It can abstain when vocabulary overlap or score separation is insufficient. Model lab lets you retrain it, test text, and export its weights.\n\nIt is a topic classifier, not a generative language model. Its relative scores are not calibrated probabilities of safety or maliciousness.\n\nTo create a model in chat, ask **Create a local model**, optionally with a JSON array of labeled examples.", "## Dein lokal lernendes Modell\nAELVOR Hybrid v2 kombiniert einen TF-IDF-Softmax-Klassifikator mit Naive-Bayes-Hinweisen. Es lernt Wort-, Wortpaar- und Zeichenmerkmale aus beschrifteten Beispielen. Bei unzureichender Vokabularüberdeckung oder Score-Trennung kann es sich enthalten. Im Model-Lab kannst du ihn neu trainieren, Texte testen und Gewichte exportieren.\n\nEs ist ein Themenklassifikator, kein generatives Sprachmodell. Relative Scores sind keine kalibrierten Wahrscheinlichkeiten für Sicherheit oder Schädlichkeit.\n\nZum Erstellen im Chat: **Erstelle ein lokales Modell**, optional mit einem JSON-Array beschrifteter Beispiele.");
  return null;
}

export async function runLocalAgent(request: LocalAgentRequest): Promise<LocalAgentResult> {
  const locale = assistantReplyLocale(request.text, request.locale, request.preferences?.language);
  const t = (en: string, de: string) => choose(locale, en, de);
  const text = request.text.trim();
  const command = text.split("```")[0].split(/\r?\n/)[0].trim();
  if (text.length > 20000) throw new Error("input_too_long");
  if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let files = request.files || [];
  if (!files.length && /\b(?:same|previous|again|weiter|vorherig|erneut)\b/i.test(command)) files = [...(request.history || [])].reverse().find(item => item.role === "user" && item.attachments?.length)?.attachments || [];
  const fenced = extractBlock(text);
  const separator = text.indexOf(":");
  const body = files[0]?.content || fenced || (separator >= 0 ? text.slice(separator + 1).trim() : text);
  const result = (answer: string, steps: string[], kind: LocalAgentResult["kind"] = "analysis"): LocalAgentResult => ({ text: answer, steps, kind, language: locale });

  const arithmetic = !files.length && !fenced ? arithmeticQuestion(text) : undefined;
  if (arithmetic) {
    if (arithmetic.value) {
      const value = arithmetic.value;
      return result(`## ${t("Local arithmetic", "Lokale Arithmetik")}\n${block(value.expression, "text")}\n**${value.approximate ? "≈" : "="} ${value.decimal}**\n\n${t("Exact rational value", "Exakter rationaler Wert")}: ${value.exact}\n\n${t("Computed locally with integer fractions; no language model or code execution was used. Supports decimal-point numbers, parentheses, + − × ÷, percentages and bounded integer powers. Rounded decimals are marked ≈.", "Lokal mit ganzzahligen Brüchen berechnet; kein Sprachmodell oder Code-Ausführung verwendet. Unterstützt Zahlen mit Dezimalpunkt, Klammern, + − × ÷, Prozente und begrenzte ganzzahlige Potenzen. Gerundete Dezimalwerte sind mit ≈ markiert.")}`, ["parse-arithmetic", "compute-rational-result"], "knowledge");
    }
    const reason = arithmetic.error === "division_zero" ? t("Division by zero is undefined.", "Division durch null ist nicht definiert.") : arithmetic.error === "undefined_power" ? t("This zero-power expression needs a mathematical convention; no numeric result was assumed.", "Dieser Null-Potenzausdruck benötigt eine mathematische Konvention; es wird kein Zahlenwert angenommen.") : t("Use a numeric expression up to 240 characters with decimal points and integer powers from −16 to 16. Thousands separators, units, functions and arbitrary code are not supported.", "Nutze einen Zahlenausdruck bis 240 Zeichen mit Dezimalpunkten und ganzzahligen Potenzen von −16 bis 16. Tausendertrennzeichen, Einheiten, Funktionen und beliebiger Code werden nicht unterstützt.");
    return result(`## ${t("Calculation could not be completed", "Berechnung konnte nicht abgeschlossen werden")}\n${reason}`, ["validate-arithmetic"], "help");
  }
  const projectTarget = !files.length && !fenced ? requestedProjectTarget(command) : null;
  if (projectTarget && !/\b(?:model|modell)\b/i.test(command)) {
    const name = /(?:named|called|namens|mit dem namen)\s+["']?([^"'\n.!?]{2,80})/i.exec(command)?.[1] || "My application";
    const project = createProjectScaffold(projectTarget, name, "com.example.generatedapp", "local-starter", locale);
    return result(scaffoldMarkdown(project, locale), ["select-project-template", "organize-source-files", "provide-build-guide"], "project");
  }

  if (/(?:create|build|train|erstelle|erstell|trainier|baue|krijo).{0,50}(?:model|modell)|(?:model|modell).{0,25}(?:train|erstell)/i.test(command)) {
    const datasetFile = files.find(file => /\.json$/i.test(file.name));
    if (datasetFile?.truncated) throw new Error("dataset_excerpt");
    const candidate = datasetFile?.content || fenced || (/\[\s*\{/.test(text) ? text.slice(text.indexOf("[")) : "");
    let bundle: ModelBundle;
    if (candidate) {
      let parsed: unknown;
      try { parsed = JSON.parse(candidate); } catch { throw new Error("invalid_json"); }
      bundle = request.train ? await request.train(parsed) : trainLocalModel(parsed);
    } else bundle = request.train ? await request.train(starterExamples) : createStarterBundle();
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const metric = bundle.evaluation ? `${bundle.evaluation.correct}/${bundle.evaluation.total} (${Math.round(bundle.evaluation.accuracy * 100)}%)` : t("Not evaluated: add at least 4 examples per label and 16 total.", "Nicht bewertet: mindestens 4 Beispiele pro Klasse und 16 insgesamt hinzufügen.");
    return { bundle, kind: "model", language: locale, steps: bundle.evaluation ? ["validate-training-data", "train-classifier", "evaluate-cross-validation"] : ["validate-training-data", "train-classifier"], text: `## ${t("Local model created", "Lokales Modell erstellt")}\n**${clean(bundle.model.name)}**\n\n- ${t("Training examples", "Trainingsbeispiele")}: ${bundle.model.sampleCount}\n- ${t("Labels", "Klassen")}: ${bundle.model.labels.map(clean).join(", ")}\n- ${t("Vocabulary features", "Vokabularmerkmale")}: ${bundle.model.vocabulary.length}\n- ${t("Dataset 3-fold result", "3-fach-Ergebnis des Datensatzes")}: ${metric}\n\n${t("The model is saved in this browser. Open Model lab to test it and download the weights and Python runner. Three stratified folds test every unique example outside its training split before refitting on all data. Rejections count as incorrect. This small authored dataset does not establish real-world accuracy.", "Das Modell wird in diesem Browser gespeichert. Im Model-Lab kannst du es testen sowie Gewichte und Python-Runner herunterladen. Drei geschichtete Durchläufe testen jedes eindeutige Beispiel außerhalb seiner Trainingsaufteilung, bevor alle Daten trainiert werden. Ablehnungen zählen als falsch. Dieser kleine erstellte Datensatz belegt keine Genauigkeit in der Praxis.")}\n\n${t("This is a trained text classifier, not a general-purpose language model.", "Dies ist ein trainierter Textklassifikator, kein allgemeines Sprachmodell.")}` };
  }
  if (/\b(classify|classification|predict|klassifizier|vorhersag)\w*/i.test(command)) {
    const bundle = request.bundle || createStarterBundle();
    const prediction = predict(bundle.model, body.slice(0, 20000));
    const heading = prediction.label ? t("Local classification", "Lokale Klassifikation") : t("Insufficient evidence for classification", "Unzureichende Hinweise für eine Klassifikation");
    const status = prediction.label ? `${t("Topic candidate", "Themenkandidat")}: **${clean(prediction.label)}**` : t("The local model abstained. Add relevant, representative labeled examples and retrain in Model lab. The scores below are diagnostic candidates only.", "Das lokale Modell enthält sich. Füge passende, repräsentative beschriftete Beispiele hinzu und trainiere im Model-Lab erneut. Die folgenden Scores dienen nur der Prüfung.");
    const evidence = prediction.evidence.length ? `\n\n${t("Positive word evidence in the linear branch", "Positive Worthinweise im linearen Zweig")}: ${prediction.evidence.map(item => clean(item.feature.slice(2).replaceAll("~", " "))).join(", ")}. ${t("Compared with the runner-up; this is not a causal explanation.", "Gegenüber der zweitplatzierten Klasse; dies ist keine kausale Erklärung.")}` : "";
    return result(`## ${heading}\n${status}\n\n| ${t("Label", "Klasse")} | ${t("Relative score", "Relativer Score")} |\n| --- | --- |\n${prediction.scores.map(item => `| ${clean(item.label)} | ${(item.score * 100).toFixed(1)}% |`).join("\n")}\n\n${prediction.knownFeatures}/${prediction.totalFeatures} ${t("input features matched the trained vocabulary. Scores compare only these labels and are not calibrated safety probabilities.", "Eingabemerkmale passen zum trainierten Vokabular. Scores vergleichen nur diese Klassen und sind keine kalibrierten Sicherheitswahrscheinlichkeiten.")}${evidence}`, ["classify-text", ...(bundle.model.version === 2 ? ["check-evidence-coverage"] : [])], "model");
  }
  if (isDocumentSummary(text) && (files.length || !/\b(?:that|it|previous|last|das|es|vorherig\w*|letzte\w*)\b/i.test(command))) {
    const summary = localDocumentReply({ ...request, files, locale });
    if (summary?.knowledge.length) return summary;
  }
  if ((isDocumentSummary(text) || /\b(shorter|short version|kürzer|kurzer|kurzfassung)\w*/i.test(command)) && !files.length && request.history?.some(item => item.role === "assistant")) {
    const previous = [...request.history].reverse().find(item => item.role === "assistant")!.content;
    const summary = previous.replace(/```[\s\S]*?```/g, "").split("\n").filter(line => /^(?:#{1,3}\s|[-*]\s)/.test(line)).slice(0, 7).join("\n");
    return result(`## ${t("Short extract", "Kurzer Auszug")}\n${summary || previous.replace(/```[\s\S]*?```/g, "").slice(0, 700)}\n\n${t("Extracted from the previous response; no new facts were inferred.", "Aus der vorherigen Antwort extrahiert; keine neuen Fakten abgeleitet.")}`, ["extract-summary"], "knowledge");
  }
  if (/(?:write|create|build|generate|schreib|erstell|baue|krijo).{0,70}(?:script|skript|python|tool|werkzeug)|(?:script|skript|python).{0,40}(?:hash|sha|log|inventory|inventar)/i.test(command) || (request.mode === "build" && /hash|sha|log|inventory|inventar/i.test(command))) {
    const kind = /sha|hash|prüfsumme/i.test(command) ? "hash" : /log|ipv4|indicator|indikator/i.test(command) ? "logs" : /inventory|inventar|directory|verzeichnis|folder|ordner/i.test(command) ? "inventory" : null;
    if (kind) return result(`## ${t("Python tool created locally", "Python-Tool lokal erstellt")}\n${t("Built from a local, read-only script template. Inspect it before running it on your own machine.", "Aus einer lokalen, nur lesenden Skriptvorlage erstellt. Prüfe den Code, bevor du ihn auf deinem Rechner ausführst.")}\n\n${block(makeScript(kind), "python")}\n\n${t("Run after saving", "Nach dem Speichern ausführen")}:\n${block(`python aelvor_tool.py ${kind === "inventory" ? "/path/to/directory --limit 1000" : "/path/to/file"}`, "bash")}\n\n${t("No code was executed by this workspace. Supported generators: SHA-256, log IP counts, and file inventory.", "In diesem Workspace wurde kein Code ausgeführt. Unterstützte Generatoren: SHA-256, IP-Zählung in Logs und Dateiinventar.")}`, ["select-script-template", "build-python-artifact"], "script");
    return result(t("## Choose a supported script\nI can build a Python SHA-256 tool, a log IP counter, or a read-only file inventory. Tell me which one you want. Arbitrary program synthesis requires a generative model.", "## Wähle ein unterstütztes Skript\nIch kann ein Python-SHA-256-Tool, einen IP-Zähler für Logs oder ein nur lesendes Dateiinventar erstellen. Sag mir, welches du möchtest. Freie Programmsynthese benötigt ein generatives Modell."), ["check-supported-generator"], "help");
  }
  if (files.length) {
    const documentTask = !/\b(?:logs?|protokoll|protokolle|indicators?|indikatoren)\b/i.test(command);
    const sourceReply = documentTask && files.some(file => isDocumentFile(file.name)) ? localDocumentReply({ ...request, files: files.filter(file => isDocumentFile(file.name)), locale }) : null;
    const reports = files.filter(file => !sourceReply || !isDocumentFile(file.name)).slice(0, 3).map(file => {
      const scope = file.truncated ? t("**Input is an excerpt; results apply only to the supplied portion.**\n\n", "**Die Eingabe ist ein Auszug; Ergebnisse gelten nur für diesen Ausschnitt.**\n\n") : "";
      return scope + (/\.(py|js|jsx|ts|tsx|sh|ps1|java|go|rs|c|cpp|html|css|sql)$/i.test(file.name) ? codeReport(file.content, file.name, locale) : logReport(file.content, file.name, locale, request.bundle));
    });
    if (/sha.?256|\bhash\b/i.test(command)) reports.unshift(t("## Original-file hashing\nAttachments in chat are decoded text excerpts, so their digest is not presented as the original file's fingerprint. Use Security lab → SHA-256 → Select a file for the complete original bytes.", "## Originaldatei hashen\nChat-Anhänge sind dekodierte Textauszüge. Ihr Hash wird deshalb nicht als Fingerabdruck der Originaldatei ausgegeben. Nutze Security-Lab → SHA-256 → Datei auswählen für die vollständigen Originalbytes."));
    if (sourceReply) reports.unshift(sourceReply.text);
    return { ...result(reports.join("\n\n---\n\n"), ["read-file-excerpts", ...(sourceReply?.steps || []), "analyze-supplied-text", "build-report"]), ...(sourceReply ? { knowledge: sourceReply.knowledge } : {}) };
  }
  const codeInput = fenced || (/\n/.test(text) && /cursor\.|\bSELECT\b|\beval\s*\(|innerHTML|subprocess|\bimport\s|\bconst\s/.test(body) ? body : null);
  if (codeInput && !/```json/i.test(text) && (/review|code|prüf|analys|check|vulnerab|schwach/i.test(command) || request.mode === "investigate")) return result(codeReport(codeInput, t("Pasted code", "Eingefügter Code"), locale), ["inspect-code-patterns", "build-report"]);
  if (/json/i.test(command) && (fenced || /[\[{]/.test(text))) {
    const value = fenced || text.slice(text.search(/[\[{]/));
    const formatted = formatJson(value).replace(/```/g, "\\u0060\\u0060\\u0060");
    return result(`## ${t("JSON validated and formatted", "JSON validiert und formatiert")}\n${block(formatted, "json")}\n\n${t("Processed locally. JSON strings were treated as data, not executed.", "Lokal verarbeitet. JSON-Zeichenketten wurden als Daten behandelt und nicht ausgeführt.")}`, ["parse-json", "format-json"]);
  }
  if (/sha.?256|\bhash\b/i.test(command) && /(?:compute|calculate|berechne|hashe|fingerprint).{0,30}:|^hash\s*:/i.test(command)) return result(`## SHA-256\n${block(await hashSha256(body), "text")}\n${t("Digest of the supplied UTF-8 text only.", "Hash ausschließlich des übergebenen UTF-8-Textes.")}`, ["hash-utf8-text"]);
  const url = extractIndicators(text).urls[0];
  if (url) {
    const inspection = inspectUrl(url);
    const names: Record<UrlSignal, string> = { http: t("HTTP is unencrypted", "HTTP ist unverschlüsselt"), credentials: t("Embedded user information before @", "Eingebettete Benutzerinformationen vor @"), ip: t("IP literal as destination", "IP-Adresse als Ziel"), idn: t("Internationalized hostname", "Internationalisierter Hostname"), subdomains: t("Multiple subdomain labels", "Mehrere Subdomain-Bezeichnungen"), redirect: t("Parameter points to another host", "Parameter verweist auf einen anderen Host"), secret: t("Sensitive parameter name", "Sensibler Parametername") };
    return result(`## ${t("URL structure inspected locally", "URL-Struktur lokal geprüft")}\n- ${t("Actual destination host", "Tatsächlicher Zielhost")}: **${inspection.host}**\n- ${t("Protocol", "Protokoll")}: ${inspection.protocol}\n- Port: ${inspection.port}\n- ${t("Query parameters", "Abfrageparameter")}: ${inspection.parameterCount}\n\n### ${t("Details to review", "Details zur Prüfung")}\n${inspection.signals.length ? inspection.signals.map(signal => `- ${names[signal]}`).join("\n") : t("No supported structural signals matched.", "Keine unterstützten Strukturhinweise gefunden.")}\n\n${t("This is not a safety verdict. No destination was opened, scanned, or contacted.", "Dies ist kein Sicherheitsurteil. Kein Ziel wurde geöffnet, gescannt oder kontaktiert.")}`, ["parse-url", "inspect-url-structure"]);
  }
  if (/log|protokoll|indicator|indikator|ipv4/i.test(command) && (fenced || /\n|\d{1,3}\.\d{1,3}\./.test(text))) return result(logReport(fenced || body, t("Pasted text", "Eingefügter Text"), locale, request.bundle), ["extract-indicators", "count-log-patterns", "build-report"]);

  const sourceReply = localDocumentReply({ ...request, files: [], locale });
  if (sourceReply) return sourceReply;
  if (/latest|today|aktuell|heute|\bCVE-\d/i.test(command)) return result(t("## Current information is outside the local engine\nI do not retrieve live threat intelligence, CVE records, or news. Supply the text you want analyzed; I can extract indicators, inspect code patterns, and classify its topic locally.", "## Aktuelle Informationen liegen außerhalb des lokalen Motors\nIch rufe keine Live-Bedrohungsdaten, CVE-Datensätze oder Nachrichten ab. Übergib den zu analysierenden Text; ich kann Indikatoren extrahieren, Code-Muster prüfen und das Thema lokal klassifizieren."), ["check-local-scope"], "help");
  const note = knowledge(text, locale);
  if (note) return result(note, ["retrieve-local-knowledge"], "knowledge");
  return result(t("## AELVOR Local is ready\nI work without an external AI service using local tools, supported script templates, a small knowledge library, and a trainable text classifier.\n\nTry one of these:\n- **Analyze this URL:** followed by a complete URL.\n- **Review this code:** followed by a fenced code block or file.\n- **Analyze these logs:** followed by log lines or an attachment.\n- **Write a Python SHA-256 script**, a log analyzer, or a file inventory.\n- **Create a local model**, optionally with labeled JSON examples.\n- **Classify:** followed by text.\n- Explain **Zero Trust**, **MFA**, **SQL injection**, **least privilege**, or **SHA-256**.\n\nThis local engine cannot answer every general question, browse the web, execute arbitrary code, or create a large language model from nothing.", "## AELVOR Local ist bereit\nIch arbeite ohne externen AI-Dienst mit lokalen Tools, unterstützten Skriptvorlagen, einer kleinen Wissensbibliothek und einem trainierbaren Textklassifikator.\n\nProbiere zum Beispiel:\n- **Prüfe diese URL:** gefolgt von einer vollständigen URL.\n- **Prüfe diesen Code:** mit Codeblock oder Datei.\n- **Analysiere diese Logs:** mit Log-Zeilen oder Anhang.\n- **Schreibe ein Python-SHA-256-Skript**, einen Log-Analysator oder ein Dateiinventar.\n- **Erstelle ein lokales Modell**, optional mit beschrifteten JSON-Beispielen.\n- **Klassifiziere:** gefolgt von Text.\n- Erkläre **Zero Trust**, **MFA**, **SQL-Injection**, **minimale Berechtigungen** oder **SHA-256**.\n\nDieser lokale Motor kann nicht jede allgemeine Frage beantworten, im Web recherchieren, beliebigen Code ausführen oder aus dem Nichts ein großes Sprachmodell erstellen."), ["match-local-capabilities"], "help");
}

export function makeScript(kind: "hash" | "logs" | "inventory"): string { return attributeCode(rawScript(kind), "python"); }
