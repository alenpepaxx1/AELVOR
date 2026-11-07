// Copyright © 2026 Alen Pepa
import type { Chat } from "./workspace-state.ts";
export type Project = { id: string; name: string };
export const projectLimit = 50;
export function projectName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").normalize("NFC");
  return name.length > 0 && name.length <= 48 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
export function restoreProjects(value: unknown): Project[] {
  const result: Project[] = [], ids = new Set<string>(), names = new Set<string>();
  for (const candidate of Array.isArray(value) ? value.slice(0, projectLimit) : []) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !candidate.id || candidate.id.length > 200 || ids.has(candidate.id)) continue;
    const name = projectName(candidate.name); if (!name || names.has(name.toLowerCase())) continue;
    result.push({ id: candidate.id, name }); ids.add(candidate.id); names.add(name.toLowerCase());
  }
  return result;
}
export function saveProject(projects: Project[], name: string, id: string): Project[] {
  const normalized = projectName(name); if (!normalized) throw new Error("project_name");
  if (projects.some(project => project.id !== id && project.name.toLowerCase() === normalized.toLowerCase())) throw new Error("project_duplicate");
  if (projects.some(project => project.id === id)) return projects.map(project => project.id === id ? { ...project, name: normalized } : project);
  if (projects.length >= projectLimit) throw new Error("project_limit");
  return [...projects, { id, name: normalized }];
}
export function removeProject(projects: Project[], chats: Chat[], id: string) {
  return { projects: projects.filter(project => project.id !== id), chats: chats.map(chat => { if (chat.projectId !== id) return chat; const { projectId: _project, ...copy } = chat; return copy; }) };
}
