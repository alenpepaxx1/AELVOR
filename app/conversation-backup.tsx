"use client";
// Copyright © 2026 Alen Pepa
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Archive, Download, FileJson, Loader2, Upload, X } from "lucide-react";
import { backupLimits, createConversationBackup, parseConversationBackup, type ConversationBackup } from "../lib/conversation-workspace";
import type { Project } from "../lib/projects";
import type { Chat } from "../lib/workspace-state";
import type { Locale } from "../lib/templates";
import { downloadText } from "./markdown";

export default function ConversationBackupPanel({ chats, projects = [], locale, busy, onImport, onNotice }: { chats: Chat[]; projects?: Project[]; locale: Locale; busy: boolean; onImport: (backup: ConversationBackup) => boolean; onNotice: (text: string) => void }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const input = useRef<HTMLInputElement>(null), epoch = useRef(0), reading = useRef(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<(ReturnType<typeof parseConversationBackup> & { name: string }) | null>(null);
  useEffect(() => () => { epoch.current++; }, []);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || busy || reading.current) return;
    if (file.size > backupLimits.bytes) { onNotice(t("Choose an AELVOR conversation backup smaller than 10 MiB.", "Wähle eine AELVOR-Gesprächssicherung unter 10 MiB.")); return; }
    reading.current = true; setLoading(true); setPreview(null); const token = ++epoch.current;
    try {
      const parsed = parseConversationBackup(await file.text());
      if (epoch.current === token) setPreview({ ...parsed, name: file.name });
    } catch (error) {
      if (epoch.current === token) onNotice(error instanceof Error && error.message === "backup_too_large" ? t("This backup exceeds the import limits.", "Diese Sicherung überschreitet die Importgrenzen.") : t("This is not a valid AELVOR conversation backup. Use a JSON backup exported from Settings.", "Dies ist keine gültige AELVOR-Gesprächssicherung. Nutze eine JSON-Sicherung aus den Einstellungen."));
    } finally { if (epoch.current === token) { reading.current = false; setLoading(false); } }
  }
  return <section className="conversation-backup" aria-labelledby="backup-title"><div className="backup-heading"><span><Archive size={18}/></span><div><h3 id="backup-title">{t("Your conversations, portable.", "Deine Gespräche zum Mitnehmen.")}</h3><p>{t("Keep messages, projects, attached text, saved answers and pins in a reusable JSON backup.", "Sichere Nachrichten, Projekte, angehängten Text, gespeicherte Antworten und Pins als wiederverwendbare JSON-Datei.")}</p></div><span className="backup-count">{chats.length}</span></div>
    <div className="backup-buttons"><button className="secondary-button" disabled={!chats.length && !projects.length} onClick={() => downloadText(JSON.stringify(createConversationBackup(chats, new Date(), projects), null, 2), `aelvor-conversations-${new Date().toISOString().slice(0, 10)}.json`, "application/json")}><Download size={14}/>{t("Export backup", "Sicherung exportieren")}</button><button className="secondary-button" disabled={busy || loading} onClick={() => input.current?.click()}>{loading ? <Loader2 size={14} className="spin"/> : <Upload size={14}/>} {t("Import backup", "Sicherung importieren")}</button><input ref={input} type="file" accept=".json,application/json" hidden onChange={choose}/></div>
    {preview && <div className="backup-preview"><div><FileJson size={18}/><strong>{preview.name}</strong><button className="icon-button" aria-label={t("Dismiss backup preview", "Sicherungsvorschau schließen")} onClick={() => setPreview(null)}><X size={14}/></button></div><p>{preview.backup.chats.length} {t("conversations", "Gespräche")} · {preview.messages} {t("messages", "Nachrichten")} · {preview.backup.projects?.length || 0} {t("projects", "Projekte")}{preview.recovered > 0 && ` · ${preview.recovered} ${t("interrupted replies recovered", "unterbrochene Antworten wiederhergestellt")}`}</p><small>{t("Adds conversations without replacing existing ones. Identical copies are skipped. Drafts, AI preferences, model weights and classifier data are not included.", "Fügt Gespräche hinzu und erhält vorhandene. Identische Kopien werden übersprungen. Entwürfe, AI-Präferenzen, Modellgewichte und Klassifikatordaten sind nicht enthalten.")}</small><button className="primary-button" disabled={busy || (!preview.backup.chats.length && !preview.backup.projects?.length)} onClick={() => { if (onImport(preview.backup)) setPreview(null); }}><Upload size={14}/>{t("Add conversations", "Gespräche hinzufügen")}</button></div>}
    <p className="backup-privacy">{t("Backups include your conversation text, attached text and knowledge excerpts kept with replies. The full knowledge library has a separate backup in Knowledge library. Store backups somewhere you trust. Imports are processed on this device.", "Sicherungen enthalten Gesprächstext, angehängten Text und Wissensauszüge aus Antworten. Die vollständige Wissensbibliothek hat eine eigene Sicherung in der Wissensbibliothek. Bewahre Sicherungen an einem vertrauenswürdigen Ort auf. Importe werden auf diesem Gerät verarbeitet.")}</p>
  </section>;
}
