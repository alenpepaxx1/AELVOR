"use client";
// Copyright © 2026 Alen Pepa
import { useMemo, useState } from "react";
import { Code2, GitCompareArrows } from "lucide-react";
import { diffCodeLines, diffDisplayRows } from "../lib/project-diff";
import type { Locale } from "../lib/templates";
export default function ProjectDiffView({ before, after, path, locale }: { before: string; after: string; path: string; locale: Locale }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [view, setView] = useState<"diff" | "source">("diff");
  const diff = useMemo(() => diffCodeLines(before, after), [before, after]), display = useMemo(() => diffDisplayRows(diff.operations), [diff]);
  return <section className="cp-diff" aria-label={t("Review source changes", "Quelländerungen prüfen")}><div className="cp-diff-heading"><code>{path}</code><span className="cp-diff-count add">+{diff.added}</span><span className="cp-diff-count remove">−{diff.removed}</span><div role="group" aria-label={t("Change view", "Änderungsansicht")}><button aria-pressed={view === "diff"} className={view === "diff" ? "selected" : ""} onClick={() => setView("diff")}><GitCompareArrows size={12}/>{t("Changes", "Änderungen")}</button><button aria-pressed={view === "source"} className={view === "source" ? "selected" : ""} onClick={() => setView("source")}><Code2 size={12}/>{t("Full file", "Ganze Datei")}</button></div></div>
    {view === "source" ? <pre className="cp-diff-source">{after}</pre> : before === after ? <p className="cp-diff-empty">{t("No source changes in this file.", "Keine Quelländerungen in dieser Datei.")}</p> : <div className="cp-diff-lines" role="region" aria-label={t("Unified line comparison", "Zeilenvergleich")} tabIndex={0}>{display.rows.map(row => <div className="cp-diff-fragment" key={row.index}>{row.gapBefore > 0 && <div className="cp-diff-gap">⋯ {row.gapBefore} {t("unchanged lines", "unveränderte Zeilen")}</div>}<div className={`cp-diff-row ${row.kind}`}><span>{row.oldLine ?? ""}</span><span>{row.newLine ?? ""}</span><b aria-label={row.kind === "add" ? t("Added line", "Hinzugefügte Zeile") : row.kind === "remove" ? t("Removed line", "Entfernte Zeile") : undefined}>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</b><code>{row.text.replace(/\r?\n$/, "") || " "}{!row.text.endsWith("\n") && <small> {t("· no final newline", "· kein abschließender Zeilenumbruch")}</small>}</code></div></div>)}</div>}
    {view === "diff" && (diff.coarse || display.truncated) && <p className="cp-diff-note">{diff.coarse ? t("Large change shown as a block replacement. ", "Große Änderung als Blockersetzung dargestellt. ") : ""}{display.truncated ? t("Showing up to 400 comparison rows. ", "Bis zu 400 Vergleichszeilen werden angezeigt. ") : ""}{t("Use Full file to inspect all proposed source.", "Nutze Ganze Datei für den vollständigen vorgeschlagenen Quellcode.")}</p>}
  </section>;
}
