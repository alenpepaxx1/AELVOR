"use client";
// Copyright © 2026 Alen Pepa
import { Folder, FolderPlus, Layers3, Pencil } from "lucide-react";
import type { Project } from "../lib/projects";
import type { Chat } from "../lib/workspace-state";
import type { Locale } from "../lib/templates";
export default function ProjectNavigation({ projects, chats, selected, locale, onSelect, onEdit, onCreate }: { projects: Project[]; chats: Chat[]; selected: string | null; locale: Locale; onSelect: (id: string | null) => void; onEdit: (project: Project) => void; onCreate: () => void }) {
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const counts = new Map<string, number>(); for (const chat of chats) if (chat.projectId) counts.set(chat.projectId, (counts.get(chat.projectId) || 0) + 1);
  return <section className="project-navigation" aria-label={t("Projects", "Projekte")}><div className="project-nav-heading"><span>{t("PROJECTS", "PROJEKTE")}</span><button onClick={onCreate} aria-label={t("Create project", "Projekt erstellen")} title={t("Create project", "Projekt erstellen")}><FolderPlus size={14}/></button></div><button className={`project-all ${selected === null ? "selected" : ""}`} onClick={() => onSelect(null)} aria-pressed={selected === null}><Layers3 size={14}/><span>{t("All conversations", "Alle Gespräche")}</span><small>{chats.length}</small></button>{projects.map(project => <div className={`project-row ${selected === project.id ? "selected" : ""}`} key={project.id}><button onClick={() => onSelect(project.id)} aria-pressed={selected === project.id} title={project.name}><Folder size={14}/><span>{project.name}</span><small>{counts.get(project.id) || 0}</small></button><button className="project-edit" onClick={() => onEdit(project)} aria-label={t(`Edit project ${project.name}`, `Projekt ${project.name} bearbeiten`)} title={t("Edit project", "Projekt bearbeiten")}><Pencil size={11}/></button></div>)}</section>;
}
