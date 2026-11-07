// Copyright © 2026 Alen Pepa
import { COPYRIGHT_NOTICE } from "./brand.ts";
import { validateCodeProjects, type CodeProject } from "./code-projects.ts";
export type ProjectVersion = { id: string; projectId: string; label: string; createdAt: number; snapshot: CodeProject };
export const projectVersionsKey = "aelvor-project-versions-v1";
export const projectVersionLimits = { versions: 24, perProject: 8, characters: 900_000, bytes: 4 * 1024 * 1024 } as const;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function projectVersionLabel(value: string) { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Checkpoint"; }
export function projectSourceSignature(project: CodeProject): string { return JSON.stringify([project.name, project.slug, project.target, project.imported === true, [...project.files].sort((a, b) => a.path.localeCompare(b.path)).map(file => [file.path, file.content])]); }
function characters(versions: ProjectVersion[]) { return versions.reduce((sum, version) => sum + version.snapshot.files.reduce((count, file) => count + file.content.length, 0), 0); }
function versionText(versions: ProjectVersion[]) { return JSON.stringify({ format: "aelvor-project-versions", version: 1, copyright: COPYRIGHT_NOTICE, versions }); }
export function validateProjectVersions(value: unknown): ProjectVersion[] {
  if (!Array.isArray(value) || value.length > projectVersionLimits.versions) throw Error("project_versions_limit");
  const ids = new Set<string>(), counts = new Map<string, number>();
  const versions = value.map(item => {
    if (!item || typeof item !== "object" || !identifier(item.id) || ids.has(item.id) || !identifier(item.projectId) || typeof item.label !== "string" || !item.label.trim() || item.label.length > 80 || /[\u0000-\u001f\u007f]/.test(item.label) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 || item.createdAt > 8_640_000_000_000_000) throw Error("project_versions_invalid");
    const snapshot = validateCodeProjects([item.snapshot])[0]; if (snapshot.id !== item.projectId) throw Error("project_versions_invalid");
    ids.add(item.id); counts.set(item.projectId, (counts.get(item.projectId) || 0) + 1);
    if (counts.get(item.projectId)! > projectVersionLimits.perProject) throw Error("project_versions_limit");
    return { id: item.id, projectId: item.projectId, label: item.label, createdAt: item.createdAt, snapshot };
  });
  if (characters(versions) > projectVersionLimits.characters || new TextEncoder().encode(versionText(versions)).byteLength > projectVersionLimits.bytes) throw Error("project_versions_limit");
  return versions;
}
export function projectVersionsBackup(versions: ProjectVersion[]) { return JSON.parse(versionText(validateProjectVersions(versions))) as { format: string; version: number; copyright: string; versions: ProjectVersion[] }; }
export function parseProjectVersions(text: string): ProjectVersion[] {
  if (text.length > projectVersionLimits.bytes || new TextEncoder().encode(text).byteLength > projectVersionLimits.bytes) throw Error("project_versions_limit");
  let value; try { value = JSON.parse(text); } catch { throw Error("project_versions_invalid"); }
  if (!value || value.format !== "aelvor-project-versions" || value.version !== 1) throw Error("project_versions_invalid");
  return validateProjectVersions(value.versions);
}
export function readProjectVersions(storage?: Pick<Storage, "getItem">) { try { const text = (storage ?? globalThis.localStorage).getItem(projectVersionsKey); return { versions: text === null ? [] : parseProjectVersions(text), error: false }; } catch { return { versions: [] as ProjectVersion[], error: true }; } }
export function writeProjectVersions(versions: ProjectVersion[], storage?: Pick<Storage, "setItem">): boolean { try { (storage ?? globalThis.localStorage).setItem(projectVersionsKey, versionText(validateProjectVersions(versions))); return true; } catch { return false; } }
export function addProjectVersion(existing: ProjectVersion[], project: CodeProject, label: string, id: string, now = Date.now()) {
  const history = validateProjectVersions(existing), snapshot = validateCodeProjects([project])[0], latest = history.find(version => version.projectId === snapshot.id);
  if (latest && projectSourceSignature(latest.snapshot) === projectSourceSignature(snapshot)) return { versions: history, created: false, pruned: 0 };
  if (!identifier(id) || history.some(version => version.id === id)) throw Error("project_versions_invalid");
  const first: ProjectVersion = { id, projectId: snapshot.id, label: projectVersionLabel(label), createdAt: now, snapshot };
  validateProjectVersions([first]);
  let count = 0;
  const candidate = [first, ...history.filter(version => version.projectId !== snapshot.id || ++count < projectVersionLimits.perProject)].slice(0, projectVersionLimits.versions);
  while (characters(candidate) > projectVersionLimits.characters || new TextEncoder().encode(versionText(candidate)).byteLength > projectVersionLimits.bytes) candidate.pop();
  return { versions: validateProjectVersions(candidate), created: true, pruned: history.length + 1 - candidate.length };
}
export function mergeProjectVersions(existing: ProjectVersion[], incoming: ProjectVersion[], makeId: () => string) {
  const result = validateProjectVersions(existing), additions = validateProjectVersions(incoming), ids = new Set(result.map(version => version.id)); let skipped = 0;
  const signature = (version: ProjectVersion) => JSON.stringify([version.projectId, version.label, projectSourceSignature(version.snapshot)]);
  const known = new Set(result.map(signature));
  for (const version of additions) {
    if (known.has(signature(version))) { skipped++; continue; }
    let id = version.id, attempts = 0; while (ids.has(id) && attempts++ < 100) id = makeId();
    if (!identifier(id) || ids.has(id)) throw Error("project_versions_invalid");
    ids.add(id); known.add(signature(version)); result.push({ ...version, id });
  }
  return { versions: validateProjectVersions(result), added: result.length - existing.length, skipped };
}
export function restoreProjectVersion(projects: CodeProject[], input: ProjectVersion, asCopy: boolean, makeId: () => string, now = Date.now()) {
  const current = validateCodeProjects(projects), version = validateProjectVersions([input])[0], existing = current.find(project => project.id === version.projectId);
  const copy = asCopy || !existing; let id = existing?.id || "";
  if (copy) { const used = new Set([...current.map(project => project.id), version.projectId]); let attempts = 0; do { id = makeId(); } while (used.has(id) && attempts++ < 100); if (!identifier(id) || used.has(id)) throw Error("project_versions_invalid"); }
  const restored: CodeProject = { ...version.snapshot, id, createdAt: copy ? now : existing!.createdAt, updatedAt: now };
  return { projects: validateCodeProjects(copy ? [...current, restored] : current.map(project => project.id === id ? restored : project)), id, asCopy: copy };
}
