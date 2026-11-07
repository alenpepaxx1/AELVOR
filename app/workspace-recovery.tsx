"use client";
// Copyright © 2026 Alen Pepa
import { useState } from "react";
import type { Locale } from "../lib/templates";
import type { WorkspaceStorageIssue } from "../lib/workspace-storage";

export default function WorkspaceRecovery({ issue, locale, busy, target = "workspace", onDownload, onReplace }: {
  issue: WorkspaceStorageIssue; locale: Locale; busy: boolean;
  target?: "workspace" | "drafts";
  onDownload: () => void; onReplace: () => boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const drafts = target === "drafts", headingId = `${target}-recovery-title`;
  return <section className="workspace-recovery" aria-labelledby={headingId}>
    <strong id={headingId}>{drafts ? t("Protecting your saved drafts", "Deine gespeicherten Entwürfe werden geschützt") : t("Protecting your saved workspace", "Dein gespeicherter Workspace wird geschützt")}</strong>
    <p>{drafts
      ? t("Saved drafts could not be read. Draft saving is paused to protect the original text and files. Copy unsent text or download the originals before replacing them. Conversation history can still be saved.", "Gespeicherte Entwürfe konnten nicht gelesen werden. Zum Schutz der ursprünglichen Texte und Dateien ist das Speichern von Entwürfen pausiert. Kopiere ungesendeten Text oder lade die Originaldaten herunter, bevor du sie ersetzt. Der Gesprächsverlauf kann weiterhin gespeichert werden.")
      : issue.kind === "invalid"
      ? t("Saved data could not be read. Automatic saving, draft saving and backup imports are paused. Download the original data before replacing it.", "Gespeicherte Daten konnten nicht gelesen werden. Automatisches Speichern, Entwürfe und Sicherungsimporte sind pausiert. Lade die Originaldaten herunter, bevor du sie ersetzt.")
      : t("Browser storage could not be accessed. Saving and backup imports are paused. Enable storage and reload after exporting any work from this session.", "Auf den Browserspeicher konnte nicht zugegriffen werden. Speichern und Sicherungsimporte sind pausiert. Aktiviere den Speicher und lade die Seite neu, nachdem du deine Arbeit aus dieser Sitzung exportiert hast.")}</p>
    <div className="recovery-actions">
      <button className="secondary-button" disabled={issue.raw === null} onClick={onDownload}>{t("Download original data", "Originaldaten herunterladen")}</button>
      {!confirm && <button className="secondary-button" disabled={busy} onClick={() => setConfirm(true)}>{drafts ? t("Replace saved drafts…", "Gespeicherte Entwürfe ersetzen…") : t("Replace saved workspace…", "Gespeicherten Workspace ersetzen…")}</button>}
    </div>
    {confirm && <div className="confirm-clear">
      <p>{drafts ? t("Replace the saved drafts with this session's unsent text and files? The original drafts will be overwritten. Download them first if you need to keep them.", "Gespeicherte Entwürfe durch die ungesendeten Texte und Dateien dieser Sitzung ersetzen? Die ursprünglichen Entwürfe werden überschrieben. Lade sie zuerst herunter, wenn du sie behalten möchtest.") : t("Replace the saved conversation history, conversation folders, workspace preferences and drafts with this session? The old data will be overwritten. Keep an export first.", "Gespeicherten Gesprächsverlauf, Gesprächsordner, Workspace-Einstellungen und Entwürfe durch diese Sitzung ersetzen? Die alten Daten werden überschrieben. Erstelle zuerst einen Export.")}</p>
      <div className="recovery-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>{t("Cancel", "Abbrechen")}</button><button className="danger-button" disabled={busy} onClick={() => { if (onReplace()) setConfirm(false); }}>{t("Replace saved data", "Gespeicherte Daten ersetzen")}</button></div>
    </div>}
  </section>;
}

export function SavingWarning({ locale, issue, draftsIssue, failed, onOpen, onRetry }: {
  locale: Locale; issue: boolean; draftsIssue: boolean; failed: boolean;
  onOpen: () => void; onRetry: () => void;
}) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  if (!issue && !draftsIssue && !failed) return null;
  return <div className="workspace-storage-warning" role="status">
    <span>{issue ? t("Saving is paused to protect your existing data.", "Speichern ist zum Schutz deiner vorhandenen Daten pausiert.") : draftsIssue ? t("Draft saving is paused. Keep a copy of unsent text.", "Entwürfe werden nicht gespeichert. Bewahre eine Kopie von ungesendetem Text auf.") : t("Some changes could not be saved. Export conversations and copy unsent text before closing.", "Einige Änderungen konnten nicht gespeichert werden. Exportiere Gespräche und kopiere ungesendeten Text vor dem Schließen.")}</span>
    <div className="recovery-actions">{!issue && !draftsIssue && <button className="secondary-button" onClick={onRetry}>{t("Retry saving", "Speichern wiederholen")}</button>}<button className="secondary-button" onClick={onOpen}>{issue || draftsIssue ? t("Open recovery", "Wiederherstellung öffnen") : t("Open settings & export", "Einstellungen & Export öffnen")}</button></div>
  </div>;
}
