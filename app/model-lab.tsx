"use client";
// Copyright © 2026 Alen Pepa

import { useEffect, useRef, useState } from "react";
import { Activity, BrainCircuit, Check, Download, FlaskConical, Loader2, Play, Square, Upload } from "lucide-react";
import { predict, pythonModelRunner, restoreBundle, starterExamples, type ModelBundle, type Prediction, type TrainProgress } from "../lib/local-model";
import { abortable } from "../lib/conversation";
import { trainInWorker } from "../lib/model-training";
import type { Locale } from "../lib/templates";
import { downloadText } from "./markdown";

export default function ModelLab({ locale, bundle, onChange, onNotice }: { locale: Locale; bundle: ModelBundle | null; onChange: (bundle: ModelBundle) => void; onNotice: (message: string) => void }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [dataset, setDataset] = useState("");
  const [name, setName] = useState("AELVOR Hybrid v2");
  const [testText, setTestText] = useState("");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [training, setTraining] = useState(false);
  const [importing, setImporting] = useState(false);
  const operationBusy = training || importing;
  const [progress, setProgress] = useState<TrainProgress | null>(null);
  const [epochs, setEpochs] = useState<20 | 40 | 80>(40);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (bundle) { controller.current?.abort(); setName(bundle.model.name); setDataset(JSON.stringify(bundle.examples, null, 2)); setPrediction(null); if (bundle.model.version === 2) setEpochs(bundle.model.training.epochs); }
  }, [bundle]);
  useEffect(() => () => controller.current?.abort(), []);
  const errors: Record<string, string> = {
    dataset_size: t("Use 8–500 labeled examples.", "Nutze 8–500 beschriftete Beispiele."),
    dataset_labels: t("Use 2–12 labels, with at least 2 examples per label.", "Nutze 2–12 Klassen mit mindestens 2 Beispielen pro Klasse."),
    dataset_unique: t("After removing identical texts, at least 8 unique examples and 2 per label are required.", "Nach Entfernen identischer Texte sind mindestens 8 eindeutige Beispiele und 2 pro Klasse erforderlich."),
    conflicting_labels: t("Identical normalized texts have different labels. Resolve the conflicting examples.", "Identische normalisierte Texte haben verschiedene Klassen. Löse die widersprüchlichen Beispiele auf."),
    invalid_dataset: t("Each example needs a label (1–32 letters, digits, spaces, _ or -) and text (4–2,000 characters).", "Jedes Beispiel benötigt eine Klasse (1–32 Buchstaben, Ziffern, Leerzeichen, _ oder -) und Text (4–2.000 Zeichen)."),
    invalid_model: t("This file is not a supported AELVOR model with valid dimensions and finite weights.", "Diese Datei ist kein unterstütztes AELVOR-Modell mit gültigen Dimensionen und endlichen Gewichten."),
    invalid_json: t("Check the JSON structure before training or importing.", "Prüfe die JSON-Struktur vor Training oder Import."),
    input_too_long: t("Use up to 20,000 characters for prediction.", "Nutze höchstens 20.000 Zeichen für die Vorhersage."),
    file_too_large: t("Choose a JSON model file smaller than 4 MB.", "Wähle eine JSON-Modelldatei kleiner als 4 MB."),
    worker_unavailable: t("This browser cannot run background training. Try a current browser.", "Dieser Browser unterstützt kein Hintergrundtraining. Nutze einen aktuellen Browser."),
    training_failed: t("Background training failed. Retry with a smaller dataset.", "Hintergrundtraining fehlgeschlagen. Versuche einen kleineren Datensatz."),
  };
  async function train() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setTraining(true); setProgress(null); setError(""); setPrediction(null);
    try {
      let examples: unknown;
      try { examples = JSON.parse(dataset); } catch { throw new Error("invalid_json"); }
      const start = performance.now();
      const next = await trainInWorker(examples, name, { epochs, signal: abort.signal, onProgress: setProgress });
      onChange(next);
      onNotice(t(`Trained ${next.model.sampleCount} unique examples locally in ${(Math.round(performance.now() - start) / 1000).toFixed(1)} s.`, `${next.model.sampleCount} eindeutige Beispiele lokal in ${(Math.round(performance.now() - start) / 1000).toFixed(1)} s trainiert.`));
    } catch (failure) {
      if (abort.signal.aborted) onNotice(t("Training cancelled. Your previous model is still active.", "Training abgebrochen. Dein vorheriges Modell ist weiterhin aktiv."));
      else setError(failure instanceof Error ? failure.message : "invalid_dataset");
    } finally { if (controller.current === abort) { controller.current = null; setTraining(false); setProgress(null); } }
  }
  async function importModel(file: File) {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort; setImporting(true);
    try {
      if (file.size > 4_000_000) throw new Error("file_too_large");
      let value: unknown;
      const text = await abortable(file.text(), abort.signal);
      try { value = JSON.parse(text); } catch { throw new Error("invalid_json"); }
      onChange(restoreBundle(value)); setError("");
      onNotice(t("Model imported. Train its examples to compute verified evaluation results.", "Modell importiert. Trainiere seine Beispiele, um geprüfte Bewertungsergebnisse zu berechnen."));
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "invalid_model"); }
    finally { if (controller.current === abort) { controller.current = null; setImporting(false); } }
  }

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  if (!bundle) return <div className="studio-empty"><Loader2 className="spin" size={25}/><p>{t("Preparing the local model…", "Lokales Modell wird vorbereitet…")}</p></div>;
  const model = bundle.model, evaluation = bundle.evaluation;
  const loss = model.version === 2 ? model.training.loss : [];
  const maxLoss = Math.max(...loss, 0.01), minLoss = Math.min(...loss, 0);
  const lossPoints = loss.map((value, index) => `${index * 290 / Math.max(1, loss.length - 1)},${60 - (value - minLoss) * 51 / Math.max(0.01, maxLoss - minLoss)}`).join(" ");
  const rejection = prediction?.reason === "ambiguous" ? t("The leading classes are too close or the leading score is too low. Add more representative examples.", "Die führenden Klassen liegen zu nah beieinander oder der höchste Score ist zu niedrig. Füge repräsentativere Beispiele hinzu.") : prediction?.reason === "low-coverage" ? t("Too little of this text is represented by the training vocabulary. A candidate is shown only for inspection.", "Zu wenig dieses Textes wird durch das Trainingsvokabular abgedeckt. Ein Kandidat wird nur zur Prüfung angezeigt.") : t("No known vocabulary matched. Add relevant labeled examples and retrain.", "Kein bekanntes Vokabular gefunden. Füge passende beschriftete Beispiele hinzu und trainiere neu.");
  return <div className="model-lab">
    <div className="lab-label"><BrainCircuit size={13}/>{t("LOCAL MODEL STUDIO", "LOKALES MODELL-STUDIO")}</div>
    <h2>{t("Train. Understand.", "Trainieren. Verstehen.")}<br/><span>{t("Make it your own.", "Dein eigenes Modell.")}</span></h2>
    <p className="tool-description">{t("A trainable bilingual text model with word and character features, explanations, and explicit uncertainty. Training runs on your device.", "Ein trainierbares zweisprachiges Textmodell mit Wort- und Zeichenmerkmalen, Erklärungen und expliziter Unsicherheit. Das Training läuft auf deinem Gerät.")}</p>
    <div className="model-type"><span><BrainCircuit size={18}/></span><div><strong>{model.name}</strong><small>{model.version === 2 ? "TF-IDF · Softmax + Naive Bayes · v2" : "Multinomial Naive Bayes · v1"}</small></div><Check size={14}/></div>
    <div className="model-stats"><div><strong>{model.sampleCount}</strong><span>{t("Examples", "Beispiele")}</span></div><div><strong>{model.labels.length}</strong><span>{t("Labels", "Klassen")}</span></div><div><strong>{model.vocabulary.length.toLocaleString(locale)}</strong><span>{t("Features", "Merkmale")}</span></div><div><strong>{evaluation ? percent(evaluation.accuracy) : "—"}</strong><span>{t("CV accuracy", "CV-Genauigkeit")}</span></div></div>
    <div className="model-labels">{model.labels.map(label => <span key={label}>{label}</span>)}</div>
    <p className="model-limits">{t("Specialized topic classification. Relative scores are uncalibrated; topic labels are not threat verdicts. General AI conversation uses the separate pretrained language model.", "Spezialisierte Themenklassifikation. Relative Scores sind unkalibriert; Themenklassen sind keine Bedrohungsurteile. Allgemeine AI-Gespräche verwenden das separate vortrainierte Sprachmodell.")}</p>
    {model.version === 1 && <p className="model-data-help">{t("Your v1 model is preserved. Train your examples below to upgrade to v2.", "Dein v1-Modell bleibt erhalten. Trainiere deine Beispiele unten für ein Upgrade auf v2.")}</p>}
    <div className="model-export-actions">
      <button onClick={() => downloadText(JSON.stringify(model, null, 2), "aelvor-local-model.json", "application/json")}><Download size={13}/>{t("Weights", "Gewichte")}</button>
      <button onClick={() => downloadText(JSON.stringify(bundle, null, 2), "aelvor-model-backup.json", "application/json")}><Download size={13}/>{t("Full backup", "Sicherung")}</button>
      <button onClick={() => downloadText(pythonModelRunner, "aelvor_predict.py", "text/x-python")}><Download size={13}/>Python</button>
      <button disabled={operationBusy} onClick={() => fileInput.current?.click()}><Upload size={13}/>{importing ? t("Importing…", "Wird importiert…") : t("Import", "Importieren")}</button>
      <input type="file" accept=".json,application/json" hidden ref={fileInput} onChange={event => { const file = event.target.files?.[0]; if (file) void importModel(file); event.target.value = ""; }}/>
    </div>

    <section className="model-section">
      <div className="tool-section-title"><FlaskConical size={16}/><h3>{t("Inspect a prediction", "Vorhersage untersuchen")}</h3></div>
      <label className="model-field-label" htmlFor="model-test-input">{t("TEXT TO CLASSIFY", "TEXT ZUM KLASSIFIZIEREN")}</label>
      <textarea id="model-test-input" value={testText} onChange={event => { setTestText(event.target.value); setPrediction(null); }} placeholder={t("Paste a message, log excerpt, or description…", "Nachricht, Log-Auszug oder Beschreibung einfügen…")} maxLength={20000}/>
      <button className="run-tool" disabled={!testText.trim()} onClick={() => { try { setPrediction(predict(model, testText)); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "input_too_long"); } }}><Play size={12} fill="currentColor"/>{t("Classify locally", "Lokal klassifizieren")}</button>
      {prediction && <div className={`model-prediction ${prediction.label ? "" : "abstained"}`} aria-live="polite">
        <div className="prediction-heading"><span>{prediction.label ? t("TOPIC CANDIDATE", "THEMENKANDIDAT") : t("NO RELIABLE CLASSIFICATION", "KEINE VERLÄSSLICHE KLASSIFIKATION")}</span><strong>{prediction.label || t("Insufficient evidence", "Unzureichende Hinweise")}</strong></div>
        {!prediction.label && <p>{rejection}</p>}
        {prediction.scores.map(item => <div className="model-score" key={item.label}><div><span>{item.label}</span><strong>{percent(item.score)}</strong></div><div><span style={{ width: `${Math.max(1, item.score * 100)}%` }}/></div></div>)}
        <p>{prediction.knownFeatures}/{prediction.totalFeatures} {t("features matched. Scores compare the configured classes only.", "Merkmale passen. Scores vergleichen nur die konfigurierten Klassen.")}</p>
        {model.version === 2 && <div className="prediction-coverage"><span>{t("Word overlap", "Wortüberdeckung")}<strong>{percent(prediction.wordCoverage)}</strong></span><span>{t("Character overlap", "Zeichenüberdeckung")}<strong>{percent(prediction.charCoverage)}</strong></span><span>{t("Score gap", "Score-Abstand")}<strong>{percent(prediction.margin)}</strong></span></div>}
        {!!prediction.evidence.length && <details className="model-details"><summary>{t("Why this candidate?", "Warum dieser Kandidat?")}</summary><p>{t("Positive word contributions in the linear branch, compared with the runner-up. This explains part of the ensemble score, not a causal conclusion.", "Positive Wortbeiträge im linearen Zweig gegenüber der zweitplatzierten Klasse. Dies erklärt einen Teil des Ensemble-Scores, keinen kausalen Zusammenhang.")}</p><div className="model-evidence">{prediction.evidence.map(item => <span key={item.feature}>{item.feature.slice(2).replaceAll("~", " ")}<small>+{item.contribution.toFixed(3)}</small></span>)}</div></details>}
      </div>}
    </section>

    <section className="model-section">
      <div className="tool-section-title"><BrainCircuit size={16}/><h3>{t("Train your model", "Dein Modell trainieren")}</h3></div>
      <label className="model-field-label" htmlFor="model-name">{t("MODEL NAME", "MODELLNAME")}</label>
      <input id="model-name" className="model-name-input" value={name} onChange={event => setName(event.target.value)} maxLength={60} disabled={operationBusy}/>
      <div className="model-profile" role="group" aria-label={t("Training epochs", "Trainingsepochen")}>{([20, 40, 80] as const).map(value => <button key={value} className={epochs === value ? "selected" : ""} aria-pressed={epochs === value} onClick={() => setEpochs(value)} disabled={operationBusy}><strong>{value}</strong><span>{t("epochs", "Epochen")}</span></button>)}</div>
      <p className="model-data-help">{t("More passes take longer and do not guarantee better generalization. Compare the evaluation after training.", "Mehr Durchläufe dauern länger und garantieren keine bessere Generalisierung. Vergleiche die Bewertung nach dem Training.")}</p>
      <div className="tool-input-label"><label htmlFor="model-dataset">{t("LABELED EXAMPLES · JSON", "BESCHRIFTETE BEISPIELE · JSON")}</label><button onClick={() => setDataset(JSON.stringify(starterExamples, null, 2))} disabled={operationBusy}>{t("Load sample", "Beispiel laden")}</button></div>
      <textarea id="model-dataset" className="model-dataset" value={dataset} onChange={event => setDataset(event.target.value)} maxLength={1200000} spellCheck={false} disabled={operationBusy}/>
      <p className="model-data-help">{t('Format: [{"label":"topic","text":"example text"}, …]. 8–500 unique examples, 2–12 labels, at least 2 per label. Identical normalized texts are deduplicated; conflicting labels are rejected.', 'Format: [{"label":"thema","text":"Beispieltext"}, …]. 8–500 eindeutige Beispiele, 2–12 Klassen, mindestens 2 pro Klasse. Identische normalisierte Texte werden zusammengeführt; widersprüchliche Klassen abgelehnt.')}</p>
      <button className="run-tool" disabled={operationBusy || !dataset.trim()} onClick={() => void train()}>{training ? <Loader2 size={14} className="spin"/> : <BrainCircuit size={15}/>} {training ? t("Training locally…", "Lokales Training…") : t("Train Hybrid v2", "Hybrid v2 trainieren")}</button>
      {training && <div className="model-training-status" role="status"><div><span>{progress?.phase === "cross-validation" ? t(`Validation fold ${progress.fold}/3`, `Validierungsdurchlauf ${progress.fold}/3`) : t("Fitting final model", "Endgültiges Modell trainieren")}</span><button onClick={() => controller.current?.abort()}><Square size={9} fill="currentColor"/>{t("Cancel", "Abbrechen")}</button></div><progress max={1} value={progress?.progress || 0}/><small>{progress?.epoch ? `${t("Epoch", "Epoche")} ${progress.epoch}/${progress.epochs} · ${t("Loss", "Verlust")} ${progress.loss?.toFixed(4)}` : t("Validating training data…", "Trainingsdaten werden validiert…")}</small></div>}
      <button className="export-dataset" onClick={() => { try { const data = JSON.parse(dataset); downloadText(JSON.stringify(data, null, 2), "aelvor-training-data.json", "application/json"); } catch { setError("invalid_json"); } }}><Download size={12}/>{t("Export training data", "Trainingsdaten exportieren")}</button>
      {!!loss.length && <div className="model-loss"><div><Activity size={12}/><strong>{t("Training objective", "Trainingszielfunktion")}</strong><span>{loss[0].toFixed(3)} → {loss[loss.length - 1].toFixed(3)}</span></div><svg viewBox="0 0 290 65" role="img" aria-label={t("Measured regularized training loss across epochs", "Gemessener regularisierter Trainingsverlust je Epoche")}><path d="M0 61 H290" stroke="currentColor" opacity=".15"/><polyline points={lossPoints} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg><small>{t("Measured on training data; lower loss is not evidence of better real-world accuracy.", "Auf Trainingsdaten gemessen; geringerer Verlust belegt keine bessere Genauigkeit in der Praxis.")}</small></div>}
      {model.version === 2 && model.training.duplicatesRemoved > 0 && <p className="model-data-help">{model.training.duplicatesRemoved} {t("identical examples removed before splitting.", "identische Beispiele vor der Aufteilung entfernt.")}</p>}
    </section>

    <section className="model-section">
      <div className="tool-section-title"><Activity size={16}/><h3>{t("Evaluate, then trust", "Prüfen, dann vertrauen")}</h3></div>
      {evaluation ? <>
        <div className="model-eval-grid"><div><strong>{evaluation.correct}/{evaluation.total}</strong><span>{t("Correct / all texts", "Korrekt / alle Texte")}</span></div><div><strong>{percent(evaluation.coverage)}</strong><span>{t("Accepted coverage", "Annahmequote")}</span></div><div><strong>{percent(evaluation.macroF1)}</strong><span>Macro F1</span></div><div><strong>{evaluation.selectiveAccuracy === null ? "—" : percent(evaluation.selectiveAccuracy)}</strong><span>{t("Correct / accepted", "Korrekt / angenommen")}</span></div></div>
        <p className="model-data-help">{t(`3 stratified folds · seed ${evaluation.seed}. Every unique example is tested once outside its training fold. Rejections count as incorrect in overall accuracy. Exact duplicates are removed; similar paraphrases may remain.`, `3 geschichtete Durchläufe · Seed ${evaluation.seed}. Jedes eindeutige Beispiel wird einmal außerhalb seines Trainingsdurchlaufs getestet. Ablehnungen zählen in der Gesamtgenauigkeit als falsch. Exakte Duplikate werden entfernt; ähnliche Umschreibungen können verbleiben.`)}</p>
        <details className="model-details"><summary>{t("Per-class results and baseline", "Ergebnisse je Klasse und Vergleich")}</summary><div className="model-table-wrap"><table className="model-metrics-table"><thead><tr><th>{t("Label", "Klasse")}</th><th>N</th><th>P</th><th>R</th><th>F1</th></tr></thead><tbody>{evaluation.perLabel.map(row => <tr key={row.label}><th>{row.label}</th><td>{row.support}</td><td>{row.precision.toFixed(2)}</td><td>{row.recall.toFixed(2)}</td><td>{row.f1.toFixed(2)}</td></tr>)}</tbody></table></div><p>{t("P = precision; R = recall. F1 balances both. Rejected examples reduce recall.", "P = Präzision; R = Trefferquote. F1 kombiniert beide. Abgelehnte Beispiele reduzieren die Trefferquote.")}</p><p>{t(`Top candidate before rejection: ${percent(evaluation.candidateAccuracy)}. Naive Bayes v1 on the same folds: ${evaluation.baseline.correct}/${evaluation.total} (${percent(evaluation.baseline.accuracy)}). v1 always selects a known-vocabulary class; v2 may abstain.`, `Spitzenkandidat vor Ablehnung: ${percent(evaluation.candidateAccuracy)}. Naive Bayes v1 mit denselben Durchläufen: ${evaluation.baseline.correct}/${evaluation.total} (${percent(evaluation.baseline.accuracy)}). v1 wählt bei bekanntem Vokabular eine Klasse; v2 kann sich enthalten.`)}</p></details>
        <details className="model-details"><summary>{t("Confusion matrix", "Konfusionsmatrix")}</summary><p>{t("Rows = actual labels; columns = predicted labels. ? = no classification.", "Zeilen = tatsächliche Klassen; Spalten = Vorhersagen. ? = keine Klassifikation.")}</p><div className="model-table-wrap"><table className="model-metrics-table confusion"><thead><tr><th></th>{evaluation.labels.map((label, index) => <th key={label} title={label}>{index + 1}</th>)}<th>?</th></tr></thead><tbody>{evaluation.confusion.map((row, index) => <tr key={evaluation.labels[index]}><th title={evaluation.labels[index]}>{index + 1}</th>{row.map((value, column) => <td key={column} className={index === column && value ? "diagonal" : ""}>{value || "·"}</td>)}</tr>)}</tbody></table></div><ol className="model-matrix-legend">{evaluation.labels.map(label => <li key={label}>{label}</li>)}</ol></details>
        <button className="export-dataset" onClick={() => downloadText(JSON.stringify(evaluation, null, 2), "aelvor-evaluation.json", "application/json")}><Download size={12}/>{t("Export evaluation report", "Bewertungsbericht exportieren")}</button>
        <p className="model-limits model-eval-warning">{t("The starter corpus is small and authored for demonstration. These results do not establish production accuracy. Use representative independent test data before relying on a model.", "Der Startdatensatz ist klein und für die Demonstration erstellt. Diese Ergebnisse belegen keine Genauigkeit im Produktiveinsatz. Nutze repräsentative unabhängige Testdaten, bevor du dich auf ein Modell verlässt.")}</p>
      </> : <p className="model-data-help">{t("Train at least 16 unique examples with 4 per label to recompute a 3-fold report. Imported or restored evaluation claims are discarded.", "Trainiere mindestens 16 eindeutige Beispiele mit 4 pro Klasse, um einen Bericht mit 3 Durchläufen zu berechnen. Importierte oder wiederhergestellte Bewertungsangaben werden verworfen.")}</p>}
    </section>
    {!!error && <div className="tool-error" role="alert">{errors[error] || t("The model action could not finish. Check the input.", "Die Modellaktion konnte nicht abgeschlossen werden. Prüfe die Eingabe.")}</div>}
    <div className="result-note">{t("Export a full backup to keep your weights and examples. Inference works with no external AI service. Run the exported model with: python aelvor_predict.py aelvor-local-model.json \"text\".", "Exportiere eine vollständige Sicherung für Gewichte und Beispiele. Vorhersagen benötigen keinen externen AI-Dienst. Exportiertes Modell ausführen: python aelvor_predict.py aelvor-local-model.json \"Text\".")}</div>
  </div>;
}
