"use client";
// Copyright © 2026 Alen Pepa
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowRight, Braces, Check, ChevronRight, Code2, Download, FileCode2, FilePlus2, Folder, FolderCode, HardDrive, History, Loader2, Monitor, Package, Plus, Search, Sparkles, Terminal, Trash2, Upload, X } from "lucide-react";
import { codeFileTree, codeProjectLimits, codeProjectPreviewArtifacts, codeProjectsBackup, mergeCodeFiles, mergeCodeProjects, parseCodeProjects, projectName, selectedCodeProjectFile, validateCodeProjects, type CodeFileSelection, type CodeProject, type CodeProjectTarget, type CodeTree } from "../lib/code-projects";
import { codeFilePath, languageForPath } from "../lib/code-files";
import { codeProjectGuide, createProjectScaffold } from "../lib/project-scaffolds";
import { codeProjectZip } from "../lib/project-zip";
import { COPYRIGHT_NOTICE } from "../lib/brand";
import type { Locale } from "../lib/templates";
import ArtifactWorkbench from "./artifact-workbench";
import ProjectTransfers from "./project-transfers";
import ProjectDiffView from "./project-diff-view";
import ProjectCodeSearch from "./project-code-search";
import ProjectVersionHistory from "./project-version-history";
import type { ProjectVersionStore } from "./use-project-versions";
import { restoreProjectVersion, type ProjectVersion } from "../lib/project-versions";
import type { CodeSearchHit } from "../lib/project-search";
import { downloadBlob, downloadText } from "./markdown";

export type CodeProjectsProps = {
  history?: ProjectVersionStore;
  onTerminal?: (projectId: string) => void;
  projects: CodeProject[]; selectedId: string | null; locale: Locale;
  saveStatus: "saved" | "pending" | "failed"; loadError: boolean;
  incoming: CodeProject | null; onDismissImport: () => void;
  onChange: (projects: CodeProject[]) => boolean; onSelect: (id: string | null) => void;
  onRetrySave: () => void; onAiRequest: (project: CodeProject, task: string, file?: string) => boolean;
};
const targets: { id: CodeProjectTarget; title: string; subtitle: string }[] = [
  { id: "web", title: "Web", subtitle: "HTML · CSS · JavaScript" }, { id: "react", title: "React", subtitle: "TypeScript · Vite" },
  { id: "python", title: "Python", subtitle: "CLI · Python 3" }, { id: "node", title: "Node.js", subtitle: "API · TypeScript" },
  { id: "android", title: "Android", subtitle: "Kotlin · Jetpack Compose" }, { id: "ios", title: "iOS", subtitle: "Swift · SwiftUI" },
  { id: "flutter", title: "Flutter", subtitle: "Dart · Android + iOS" }, { id: "general", title: "Custom", subtitle: "Any language / Jede Sprache" },
];
const makeId = () => crypto.randomUUID();
export function projectErrorText(error: unknown, locale: Locale) {
  const de = locale === "de", key = error instanceof Error ? error.message : "";
  if (key === "code_project_path") return de ? "Nutze einen relativen Textdateipfad wie src/main.py. Keine absoluten Pfade, ../, Binärdateien oder reservierten Dateinamen." : "Use a relative text file path such as src/main.py. Absolute paths, ../, binary files and reserved names are not supported.";
  if (key === "code_project_duplicate") return de ? "Ein Dateipfad ist doppelt vorhanden. Groß-/Kleinschreibung wird für die Portabilität nicht unterschieden." : "A file path already exists. Paths are case-insensitive for portability.";
  if (key === "code_project_package") return de ? "Nutze eine Paket-ID wie com.example.myapp mit mindestens drei kleingeschriebenen Teilen ohne Sprachschlüsselwörter." : "Use a package ID such as com.example.myapp with at least three lowercase segments and no language keywords.";
  if (key === "code_project_limit" || key === "code_project_file" || key === "code_project_files") return de ? "Projektgrenze erreicht: 12 Projekte, 120 Dateien je Projekt, 120.000 Zeichen je Datei, 600.000 je Projekt und 1.200.000 insgesamt." : "Project limit reached: 12 projects, 120 files per project, 120,000 characters per file, 600,000 per project and 1,200,000 in total.";
  return de ? "Die Änderung konnte nicht übernommen werden. Prüfe Format, Dateipfade und Projektgrenzen." : "The change could not be applied. Check the format, file paths and project limits.";
}
function FileTree({ nodes, selected, onSelect }: { nodes: CodeTree[]; selected: string; onSelect: (path: string) => void }) {
  return <ul className="cp-tree">{nodes.map(node => <li key={node.path}>{node.file ? <button className={selected === node.path ? "selected" : ""} aria-current={selected === node.path ? "true" : undefined} onClick={() => onSelect(node.path)} title={node.path}><FileCode2 size={13}/><span>{node.name}</span></button> : <details open><summary><ChevronRight size={11}/><Folder size={13}/><span>{node.name}</span></summary><FileTree nodes={node.children} selected={selected} onSelect={onSelect}/></details>}</li>)}</ul>;
}
export default function CodeProjects(props: CodeProjectsProps) {
  const { projects, selectedId, locale, saveStatus, loadError, incoming, onChange, onSelect, onAiRequest } = props;
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [creating, setCreating] = useState(!projects.length && !incoming), [target, setTarget] = useState<CodeProjectTarget>("react"), [name, setName] = useState(""), [packageId, setPackageId] = useState("com.example.myapp");
  const project = projects.find(item => item.id === selectedId) || projects[0];
  const [fileSelection, setFileSelection] = useState<CodeFileSelection | null>(null);
  const file = project ? selectedCodeProjectFile(project, fileSelection) : undefined;
  const [pathDraft, setPathDraft] = useState(file?.path || ""), [addingFile, setAddingFile] = useState(false), [newPath, setNewPath] = useState("src/new-file.ts"), [search, setSearch] = useState("");
  function selectFile(path: string, projectId = project?.id) { setFileSelection(projectId ? { projectId, path } : null); }
  const [view, setView] = useState<"code" | "guide" | "preview" | "search">("code"), [task, setTask] = useState(""), [feedback, setFeedback] = useState(""), [deleteChoice, setDeleteChoice] = useState<"file" | "project" | null>(null), [loading, setLoading] = useState(false);
  const [destination, setDestination] = useState(selectedId && projects.some(p => p.id === selectedId) ? selectedId : "new"), [incomingPath, setIncomingPath] = useState(incoming ? selectedCodeProjectFile(incoming).path : "");
  const [chosenIncoming, setChosenIncoming] = useState<string[]>(incoming?.files.map(file => file.path) || []);
  const [showVersions, setShowVersions] = useState(false), [focusHit, setFocusHit] = useState<(CodeSearchHit & { projectId: string; request: number }) | null>(null);
  const sourceEditor = useRef<HTMLTextAreaElement>(null);
  const backupInput = useRef<HTMLInputElement>(null), importEpoch = useRef(0), live = useRef(props); live.current = props;
  useEffect(() => () => { importEpoch.current++; }, []);
  useEffect(() => { setPathDraft(file?.path || ""); setAddingFile(false); setDeleteChoice(null); }, [project?.id, file?.path]);
  useEffect(() => { setView("code"); setSearch(""); setFeedback(""); }, [project?.id]);
  useEffect(() => { setChosenIncoming(incoming?.files.map(file => file.path) || []); setIncomingPath(incoming ? selectedCodeProjectFile(incoming).path : ""); if (incoming) { setCreating(false); setDestination(live.current.selectedId && live.current.projects.some(p => p.id === live.current.selectedId) ? live.current.selectedId : "new"); } }, [incoming?.id]);
  useEffect(() => {
    if (view !== "code" || !project || !file || !focusHit || focusHit.projectId !== project.id || focusHit.path !== file.path) return;
    const frame = requestAnimationFrame(() => {
      const editor = sourceEditor.current; if (!editor) return;
      editor.focus(); editor.setSelectionRange(focusHit.offset, focusHit.offset + focusHit.length);
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
      editor.scrollTop = Math.max(0, (focusHit.line - 1) * lineHeight - editor.clientHeight / 3);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, project?.id, file?.path, focusHit]);
  function captureBeforeChange(source: CodeProject, label: string) { if (props.history) props.history.capture(source, label); }
  function deleteSource() {
    if (!project) return;
    try {
      if (deleteChoice === "project") { captureBeforeChange(project, t("Before project deletion", "Vor Projektlöschung")); if (apply(projects.filter(item => item.id !== project.id))) { onSelect(projects.find(item => item.id !== project.id)?.id || null); setDeleteChoice(null); } }
      else if (file && project.files.length > 1) { captureBeforeChange(project, t("Before file deletion", "Vor Dateilöschung")); if (update({ ...project, files: project.files.filter(item => item.path !== file.path) })) { setFileSelection(null); setDeleteChoice(null); } }
    } catch (error) { setFeedback(projectErrorText(error, locale)); }
  }
  function saveCheckpoint() { if (!project || !props.history) return; try { const result = props.history.capture(project, t("Manual checkpoint", "Manueller Stand")); setFeedback(result.persisted ? t("Source version saved.", "Quellstand gespeichert.") : t("Version is temporary in this tab. Export history before leaving.", "Stand ist in diesem Tab temporär. Exportiere den Verlauf vor dem Verlassen.")); } catch { setFeedback(t("Version could not be saved. Check history limits.", "Stand konnte nicht gespeichert werden. Prüfe die Verlaufsgrenzen.")); } }
  function restoreVersion(version: ProjectVersion, asCopy: boolean): boolean {
    try {
      const result = restoreProjectVersion(projects, version, asCopy, makeId), existing = projects.find(item => item.id === version.projectId);
      if (existing && !result.asCopy) captureBeforeChange(existing, t("Before version restore", "Vor Wiederherstellung"));
      if (!apply(result.projects)) return false;
      onSelect(result.id); setFileSelection(null); setView("code"); setCreating(false);
      setFeedback(result.asCopy ? t("Version restored as a new project.", "Stand als neues Projekt wiederhergestellt.") : t("Project restored. The previous source is in version history.", "Projekt wiederhergestellt. Der vorherige Quellcode ist im Versionsverlauf.")); return true;
    } catch (error) { setFeedback(projectErrorText(error, locale)); return false; }
  }
  function openSearchHit(hit: CodeSearchHit) {
    if (!project) return; const source = project.files.find(file => file.path === hit.path);
    if (!source || source.content.slice(hit.offset, hit.offset + hit.length) !== hit.value) { setFeedback(t("The source changed. Search again before opening this result.", "Der Quellcode hat sich geändert. Suche erneut, bevor du diesen Treffer öffnest.")); return; }
    selectFile(hit.path); setView("code"); setFocusHit({ ...hit, projectId: project.id, request: Date.now() });
  }
  const previewArtifacts = useMemo(() => project ? codeProjectPreviewArtifacts(project) : [], [project]);
  const tree = useMemo(() => codeFileTree((project?.files || []).filter(item => item.path.toLowerCase().includes(search.toLowerCase()))), [project, search]);
  function apply(next: CodeProject[]) { try { const checked = validateCodeProjects(next); if (!onChange(checked)) return false; setFeedback(""); return true; } catch (error) { setFeedback(projectErrorText(error, locale)); return false; } }
  function update(next: CodeProject) { return apply(projects.map(item => item.id === next.id ? { ...next, updatedAt: Date.now() } : item)); }
  function create() {
    try { const next = createProjectScaffold(target, name, packageId, makeId(), locale); if (apply([...projects, next])) { onSelect(next.id); setCreating(false); setName(""); setFileSelection(null); setView("code"); } }
    catch (error) { setFeedback(projectErrorText(error, locale)); }
  }
  function renameFile() {
    if (!project || !file) return;
    try { const path = codeFilePath(pathDraft); validateCodeProjects([{ ...project, files: project.files.map(item => item.path === file.path ? { ...item, path } : item) }]); captureBeforeChange(project, t("Before file rename", "Vor Dateiumbenennung")); if (update({ ...project, files: project.files.map(item => item.path === file.path ? { ...item, path } : item) })) selectFile(path); }
    catch (error) { setFeedback(projectErrorText(error, locale)); }
  }
  function addFile() {
    if (!project) return;
    try { const path = codeFilePath(newPath); if (update({ ...project, files: [...project.files, { path, content: "" }] })) { selectFile(path); setAddingFile(false); setView("code"); } }
    catch (error) { setFeedback(projectErrorText(error, locale)); }
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0]; event.target.value = ""; if (!upload) return;
    const epoch = ++importEpoch.current; setLoading(true); setFeedback("");
    try {
      if (upload.size > codeProjectLimits.backupBytes) throw Error("code_project_limit");
      const text = await upload.text(); if (importEpoch.current !== epoch) return;
      const added = parseCodeProjects(text), merged = mergeCodeProjects(live.current.projects, added, makeId);
      if (live.current.onChange(merged.projects)) { setCreating(false); setFeedback(t(`${merged.added} projects added · ${merged.skipped} identical copies skipped.`, `${merged.added} Projekte hinzugefügt · ${merged.skipped} identische Kopien übersprungen.`)); }
    } catch (error) { if (importEpoch.current === epoch) setFeedback(projectErrorText(error, locale)); }
    finally { if (importEpoch.current === epoch) setLoading(false); }
  }
  function acceptIncoming() {
    if (!incoming) return;
    try {
      const existing = projects.find(item => item.id === destination);
      if (destination !== "new" && !existing) throw Error("code_project_invalid");
      const selectedFiles = incoming.files.filter(file => chosenIncoming.includes(file.path)); if (!selectedFiles.length) return;
      const next = existing ? mergeCodeFiles(existing, selectedFiles) : { ...incoming, id: makeId(), files: selectedFiles };
      validateCodeProjects(existing ? projects.map(item => item.id === existing.id ? next : item) : [...projects, next]);
      if (existing) captureBeforeChange(existing, t("Before AI changes", "Vor AI-Änderungen"));
      if (apply(existing ? projects.map(item => item.id === existing.id ? next : item) : [...projects, next])) { onSelect(next.id); setCreating(false); selectFile(selectedFiles.some(file => file.path === incomingPath) ? incomingPath : selectedFiles[0].path, next.id); setView("code"); props.onDismissImport(); }
    } catch (error) { setFeedback(projectErrorText(error, locale)); }
  }
  function exportZip() { if (!project) return; try { const bytes = codeProjectZip(project); downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${project.slug}.zip`); } catch (error) { setFeedback(projectErrorText(error, locale)); } }
  const buildGuide = project ? codeProjectGuide(project, locale) : null;
  const incomingDestination = projects.find(item => item.id === destination);
  const replacing = new Map(incomingDestination?.files.map(item => [item.path.toLowerCase(), item]) || []);
  const reviewedFile = incoming?.files.find(item => item.path === incomingPath);
  const reviewedBefore = reviewedFile ? replacing.get(reviewedFile.path.toLowerCase()) : undefined;
  return <section className="code-projects" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f" && project) { event.preventDefault(); setView("search"); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && project && props.history) { event.preventDefault(); saveCheckpoint(); }
  }} aria-label={t("Code projects", "Code-Projekte")}>
    <div className="cp-hero"><span className="cp-hero-icon"><FolderCode size={25}/></span><div><span className="cp-eyebrow">PROJECT BUILDER</span><h3>{t("An idea. A real starting point.", "Eine Idee. Ein echter Startpunkt.")}</h3><p>{t("Plan, organize and refine source projects with your local AI. Keep every file together, then take the source with you.", "Plane, organisiere und verfeinere Quellprojekte mit deiner lokalen AI. Alle Dateien zusammen – bereit zum Mitnehmen.")}</p></div><span className="cp-local"><HardDrive size={12}/>{t("ON DEVICE", "AUF DEM GERÄT")}</span></div>
    <div className="cp-actions"><button className="primary-button" disabled={loading || projects.length >= codeProjectLimits.projects} onClick={() => { setCreating(true); setFeedback(""); }}><Plus size={14}/>{t("New project", "Neues Projekt")}</button><button className="secondary-button" disabled={loading} onClick={() => backupInput.current?.click()}>{loading ? <Loader2 size={14} className="spin"/> : <Upload size={14}/>} {t("Import backup", "Sicherung importieren")}</button><button className="text-button" disabled={!projects.length} onClick={() => downloadText(JSON.stringify(codeProjectsBackup(projects), null, 2), "aelvor-code-projects.json", "application/json")}><Download size={13}/>{t("Back up all", "Alle sichern")}</button>{props.history && <button className="text-button" aria-expanded={showVersions} onClick={() => { setShowVersions(!showVersions); setView("code"); }}><History size={13}/>{t("Version history", "Versionsverlauf")} · {props.history.versions.length}</button>}<span className={`cp-save ${saveStatus}`} role="status">{saveStatus === "saved" ? <Check size={12}/> : saveStatus === "pending" ? <Loader2 size={12} className="spin"/> : <HardDrive size={12}/>} {saveStatus === "saved" ? t("Saved on this device", "Auf diesem Gerät gespeichert") : saveStatus === "pending" ? t("Saving…", "Speichern…") : t("Not saved", "Nicht gespeichert")}</span></div>
    <input ref={backupInput} type="file" hidden accept=".json,application/json" onChange={event => void importBackup(event)}/>
    <ProjectTransfers project={project} locale={locale} canImport={projects.length < codeProjectLimits.projects} onImport={incomingProject => {
      if (!apply([...projects, incomingProject])) return false;
      onSelect(incomingProject.id); setCreating(false); selectFile(selectedCodeProjectFile(incomingProject).path, incomingProject.id); setView("code"); return true;
    }}/>
    {props.history && !props.history.persisted && !showVersions && <p className="cp-alert" role="status">{t("Version history could not be saved or loaded. Open history to review its status and export a copy.", "Versionsverlauf konnte nicht gespeichert oder geladen werden. Öffne den Verlauf, um den Status zu prüfen und eine Kopie zu exportieren.")} <button className="text-button" onClick={() => setShowVersions(true)}>{t("Open history", "Verlauf öffnen")}</button></p>}
    {showVersions && props.history && <ProjectVersionHistory projects={projects} project={project} store={props.history} locale={locale} onRestore={restoreVersion} onClose={() => setShowVersions(false)}/>}
    {loadError && <p className="cp-alert" role="status">{t("Saved projects could not be read. Your existing browser data stays unchanged until you edit or import a project.", "Gespeicherte Projekte konnten nicht gelesen werden. Vorhandene Browserdaten bleiben unverändert, bis du ein Projekt bearbeitest oder importierst.")}</p>}
    {saveStatus === "failed" && !loadError && <div className="cp-alert" role="status">{t("Changes are active for this visit. Saving failed; older projects may return after reload. Export a backup or retry saving.", "Änderungen sind für diesen Besuch aktiv. Speichern fehlgeschlagen; frühere Projekte können nach dem Neuladen zurückkehren. Exportiere eine Sicherung oder speichere erneut.")} <button className="text-button" onClick={props.onRetrySave}>{t("Retry saving", "Erneut speichern")}</button></div>}
    {feedback && <p className="cp-alert" role="status">{feedback}</p>}
    {incoming && <div className="cp-import"><div className="cp-panel-heading"><span><Package size={16}/><strong>{t("Review files from AI", "Dateien aus AI prüfen")}</strong></span><button className="icon-button" aria-label={t("Cancel file import", "Dateiimport abbrechen")} onClick={props.onDismissImport}><X size={15}/></button></div><p>{t("Only apply complete source files. Matching paths will be replaced; other files stay in the project.", "Übernimm nur vollständige Quelldateien. Gleiche Pfade werden ersetzt; andere Dateien bleiben im Projekt.")}</p><label>{t("Destination", "Zielprojekt")}<select value={destination} onChange={event => setDestination(event.target.value)}><option value="new">{t("Create a new project", "Neues Projekt erstellen")}</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="cp-review-tools"><span>{t("Choose files to apply", "Dateien zum Übernehmen wählen")}</span><button className="text-button" disabled={chosenIncoming.length === incoming.files.length} onClick={() => setChosenIncoming(incoming.files.map(file => file.path))}>{t("Select all", "Alle auswählen")}</button><button className="text-button" disabled={!chosenIncoming.length} onClick={() => setChosenIncoming([])}>{t("Clear", "Leeren")}</button></div><div className="cp-import-files">{incoming.files.map(item => { const previous = replacing.get(item.path.toLowerCase()); return <div className="cp-incoming-row" key={item.path}><input type="checkbox" checked={chosenIncoming.includes(item.path)} aria-label={t(`Include ${item.path}`, `${item.path} übernehmen`)} onChange={event => setChosenIncoming(current => event.target.checked ? [...current, item.path] : current.filter(path => path !== item.path))}/><button className={incomingPath === item.path ? "selected" : ""} onClick={() => setIncomingPath(item.path)}><FileCode2 size={12}/><code>{item.path}</code><span>{previous ? previous.content === item.content ? t("Same", "Gleich") : t("Replace", "Ersetzen") : t("New", "Neu")}</span></button></div>; })}</div>{reviewedFile && <ProjectDiffView before={reviewedBefore?.content || ""} after={reviewedFile.content} path={reviewedBefore?.path || reviewedFile.path} locale={locale}/>}<div className="cp-form-footer"><small>{chosenIncoming.length}/{incoming.files.length} {t("files selected", "Dateien ausgewählt")}</small><button className="secondary-button" onClick={props.onDismissImport}>{t("Cancel", "Abbrechen")}</button><button className="primary-button" disabled={loading || !chosenIncoming.length || destination === "new" && projects.length >= codeProjectLimits.projects} onClick={acceptIncoming}><Check size={13}/>{t("Apply files", "Dateien übernehmen")}</button></div></div>}
    {creating && <form className="cp-create" onSubmit={event => { event.preventDefault(); create(); }}><div className="cp-panel-heading"><span><Braces size={16}/><strong>{t("Choose a starting point", "Startpunkt wählen")}</strong></span>{!!projects.length && <button type="button" className="icon-button" aria-label={t("Close project creation", "Projekterstellung schließen")} onClick={() => setCreating(false)}><X size={15}/></button>}</div><div className="cp-templates">{targets.map(item => <button type="button" key={item.id} aria-pressed={target === item.id} className={target === item.id ? "selected" : ""} onClick={() => setTarget(item.id)}><Code2 size={17}/><strong>{item.id === "general" ? t("Custom", "Individuell") : item.title}</strong><small>{item.id === "general" ? t("Any text language", "Jede Textsprache") : item.subtitle}</small>{target === item.id && <Check size={12}/>}</button>)}</div><div className="cp-create-fields"><label>{t("Project name", "Projektname")}<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder={t("My next idea", "Meine nächste Idee")}/></label>{["android", "ios"].includes(target) && <label>{t("Package / bundle ID", "Paket- / Bundle-ID")}<input autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={120} value={packageId} onChange={event => setPackageId(event.target.value)} placeholder="com.example.myapp"/></label>}</div><div className="cp-form-footer"><small>{t("Local source templates work without a model. Custom features need your implementation or a loaded AI.", "Lokale Quellvorlagen funktionieren ohne Modell. Eigene Funktionen benötigen deine Umsetzung oder eine geladene AI.")}</small><button type="submit" className="primary-button" disabled={loading || !name.trim() || projects.length >= codeProjectLimits.projects}>{t("Create source project", "Quellprojekt erstellen")}<ArrowRight size={14}/></button></div></form>}
    {project && <><div className="cp-project-bar"><label><span>{t("YOUR PROJECTS", "DEINE PROJEKTE")} · {projects.length}/12</span><select aria-label={t("Selected code project", "Ausgewähltes Code-Projekt")} value={project.id} onChange={event => { onSelect(event.target.value); setCreating(false); }}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span className="cp-target-label">{targets.find(item => item.id === project.target)?.title}</span>{props.history && <button className="secondary-button" disabled={!props.history.ready} onClick={saveCheckpoint}><History size={13}/>{t("Save version", "Stand speichern")}</button>}<button className="secondary-button" onClick={exportZip}><Download size={13}/>{t("Download ZIP", "ZIP herunterladen")}</button><button className="icon-button" title={t("Delete project", "Projekt löschen")} aria-label={t("Delete project", "Projekt löschen")} onClick={() => setDeleteChoice("project")}><Trash2 size={14}/></button></div>
      {deleteChoice && <div className="cp-alert cp-delete" role="alert"><span>{deleteChoice === "project" ? t("Delete this project's source files from this device?", "Quelldateien dieses Projekts von diesem Gerät löschen?") : t(`Delete ${file?.path}?`, `${file?.path} löschen?`)}</span><button className="text-button" onClick={() => setDeleteChoice(null)}>{t("Cancel", "Abbrechen")}</button><button className="secondary-button danger-text" onClick={deleteSource}><Trash2 size={12}/>{t("Delete", "Löschen")}</button></div>}
      <div className="cp-workspace"><aside className="cp-explorer"><div className="cp-explorer-heading"><span><FolderCode size={13}/>{t("EXPLORER", "EXPLORER")}</span><button className="icon-button" disabled={project.files.length >= codeProjectLimits.files} aria-label={t("Add file", "Datei hinzufügen")} onClick={() => setAddingFile(!addingFile)}><FilePlus2 size={14}/></button></div><label className="cp-file-search"><Search size={12}/><input maxLength={240} aria-label={t("Filter project files", "Projektdateien filtern")} placeholder={t("Find a file…", "Datei finden…")} value={search} onChange={event => setSearch(event.target.value)}/></label><FileTree nodes={tree} selected={file?.path || ""} onSelect={path => { selectFile(path); setView("code"); }}/><span className="cp-file-count">{project.files.length}/120 {t("files", "Dateien")}</span></aside><div className="cp-editor-pane"><div className="cp-tabs" role="group" aria-label={t("Project view", "Projektansicht")}><button aria-pressed={view === "code"} className={view === "code" ? "selected" : ""} onClick={() => setView("code")}><Code2 size={13}/>{t("Source", "Quellcode")}</button><button aria-pressed={view === "search"} className={view === "search" ? "selected" : ""} onClick={() => setView("search")}><Search size={13}/>{t("Search code", "Code suchen")}</button><button aria-pressed={view === "guide"} className={view === "guide" ? "selected" : ""} onClick={() => setView("guide")}><Terminal size={13}/>{t("Build guide", "Build-Anleitung")}</button>{!!previewArtifacts.length && <button aria-pressed={view === "preview"} className={view === "preview" ? "selected" : ""} onClick={() => setView("preview")}><Monitor size={13}/>{t("Web preview", "Webvorschau")}</button>}</div>
        {addingFile && <form className="cp-path-form" onSubmit={event => { event.preventDefault(); addFile(); }}><input autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={t("New relative file path", "Neuer relativer Dateipfad")} maxLength={240} value={newPath} onChange={event => setNewPath(event.target.value)} placeholder="src/main.py"/><button type="submit" className="secondary-button">{t("Add", "Hinzufügen")}</button><button type="button" className="icon-button" aria-label={t("Cancel", "Abbrechen")} onClick={() => setAddingFile(false)}><X size={13}/></button></form>}
        {view === "code" && file && <><form className="cp-path-form" onSubmit={event => { event.preventDefault(); renameFile(); }}><FileCode2 size={14}/><input autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={t("Source file path", "Quelldateipfad")} maxLength={240} value={pathDraft} onChange={event => setPathDraft(event.target.value)}/><button type="submit" className="text-button" disabled={pathDraft === file.path}>{t("Rename", "Umbenennen")}</button><button type="button" className="icon-button" disabled={project.files.length <= 1} aria-label={t("Delete selected file", "Ausgewählte Datei löschen")} onClick={() => setDeleteChoice("file")}><Trash2 size={13}/></button></form><textarea key={`${project.id}:${file.path}`} ref={sourceEditor} className="cp-source" aria-label={t("Edit project source", "Projektquellcode bearbeiten")} value={file.content} maxLength={codeProjectLimits.fileCharacters} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={event => update({ ...project, files: project.files.map(item => item.path === file.path ? { ...item, content: event.target.value } : item) })}/><div className="cp-editor-status"><span>{languageForPath(file.path)} · UTF-8</span><span>{file.content.length.toLocaleString(locale)} / 120,000 {t("characters", "Zeichen")}</span></div></>}
        <ProjectCodeSearch key={project.id} project={project} locale={locale} onOpen={openSearchHit} active={view === "search"}/>
        {view === "guide" && buildGuide && <div className="cp-build-guide">{props.onTerminal && <button className="secondary-button" onClick={() => props.onTerminal?.(project.id)}><Terminal size={13}/>{t("Open Windows terminal", "Windows-Terminal öffnen")}</button>}<div><Terminal size={22}/><h4>{t("Build on your machine", "Auf deinem Gerät bauen")}</h4><p>{buildGuide.requirements}</p></div><p>{buildGuide.note}</p>{!!buildGuide.commands.length && <pre>{buildGuide.commands.join("\n")}</pre>}<p>{t("Run these commands inside the extracted project folder. Generated changes may need additional dependencies and checks.", "Führe die Befehle im entpackten Projektordner aus. Generierte Änderungen können weitere Abhängigkeiten und Prüfungen benötigen.")}</p><div className="cp-reference-links">{buildGuide.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener">{link.label} ↗</a>)}</div><label className="cp-rename-project">{t("Project display name", "Projekt-Anzeigename")}<input key={project.id} defaultValue={project.name} maxLength={80} onBlur={event => { const nextName = projectName(event.target.value); event.target.value = nextName; if (nextName !== project.name) update({ ...project, name: nextName }); }}/></label><small>{t("ZIP folder", "ZIP-Ordner")}: {project.slug}/</small></div>}
        {view === "preview" && !!previewArtifacts.length && <ArtifactWorkbench key={`${project.id}:${project.updatedAt}`} artifact={previewArtifacts[0]} artifacts={previewArtifacts} locale={locale} active previewOnly onNotice={setFeedback}/>}
      </div></div>
      <form className="cp-ai" onSubmit={event => { event.preventDefault(); if (task.trim() && onAiRequest(project, task, file?.path)) setTask(""); }}><span className="cp-ai-icon"><Sparkles size={18}/></span><div><label htmlFor="cp-ai-task">{t("Your next step, with AI", "Dein nächster Schritt mit AI")}</label><p>{t("Adds the selected file and project paths to your chat draft. Review it, then send to a loaded model.", "Ergänzt den Chat-Entwurf um die ausgewählte Datei und Projektpfade. Prüfe ihn und sende ihn an ein geladenes Modell.")}</p><textarea id="cp-ai-task" rows={2} required maxLength={1000} value={task} onChange={event => setTask(event.target.value)} placeholder={t("For example: Add input validation to this file", "Zum Beispiel: Eingabevalidierung in dieser Datei ergänzen")}/><div className="cp-ai-footer"><small>{t("Focus", "Fokus")}: <code>{file?.path}</code></small><button className="primary-button" type="submit" disabled={!task.trim()}>{t("Add AI request to chat", "AI-Anfrage zum Chat hinzufügen")}<ArrowRight size={13}/></button></div></div></form></>}
    {!project && !creating && !incoming && <div className="cp-empty"><FolderCode size={30}/><h4>{t("Your next project starts here.", "Dein nächstes Projekt beginnt hier.")}</h4><p>{t("Choose New project to create source files, or add complete code files from a chat response using Project.", "Wähle Neues Projekt für Quelldateien oder füge vollständige Codedateien aus einer Chat-Antwort über Projekt hinzu.")}</p></div>}
    <p className="cp-footnote">{t("Sources are saved in this browser when storage is available. Export regularly. AI quality depends on the loaded model. Android/iOS builds require their own SDKs; no APK or IPA is compiled or signed here. Code project backups are separate from conversations.", "Quelldateien werden bei verfügbarem Speicher in diesem Browser gesichert. Exportiere regelmäßig. Die AI-Qualität hängt vom geladenen Modell ab. Android-/iOS-Builds benötigen eigene SDKs; hier wird keine APK oder IPA gebaut oder signiert. Code-Projektsicherungen sind von Gesprächen getrennt.")}</p><small className="cp-copyright">{COPYRIGHT_NOTICE}</small>
  </section>;
}
