// Copyright © 2026 Alen Pepa
import { BookOpen, ExternalLink } from "lucide-react";
import type { KnowledgeExcerpt } from "../lib/knowledge-library";
import type { Locale } from "../lib/templates";

export default function KnowledgeSources({ sources, locale }: { sources: KnowledgeExcerpt[]; locale: Locale }) {
  if (!sources.length) return null;
  const t = (en: string, de: string) => locale === "de" ? de : en;
  return <details className="knowledge-sources"><summary><BookOpen size={13}/>{t("Knowledge context selected", "Ausgewählter Wissenskontext")} · {sources.length}</summary><p>{t("Saved copies of the excerpts selected for this reply. This does not verify the sources or prove that every excerpt was used correctly.", "Gespeicherte Kopien der für diese Antwort ausgewählten Auszüge. Dies prüft weder die Quellen noch die korrekte Verwendung jedes Auszugs.")}</p>{sources.map(source => <section key={source.reference}><div><strong>[{source.reference}] {source.title}</strong><span>{t("Lines", "Zeilen")} {source.startLine}–{source.endLine} · {source.sourceDate || t("Source date not supplied", "Quellendatum nicht angegeben")}</span>{source.retrievedAt !== undefined && <small>{t("Retrieved", "Abgerufen")}: {new Date(source.retrievedAt).toLocaleString(locale)} · {t("Lines refer to the saved extracted text, not webpage lines.", "Zeilen beziehen sich auf den gespeicherten extrahierten Text, nicht auf Webseitenzeilen.")}</small>}</div>{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">{t("Open source link", "Quellenlink öffnen")}<ExternalLink size={11}/></a>}<pre>{source.text}</pre></section>)}</details>;
}
