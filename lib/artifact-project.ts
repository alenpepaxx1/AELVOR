// Copyright © 2026 Alen Pepa
import type { Artifact } from "./local-tools.ts";
import { codeFilePath, codePathCharacters } from "./code-files.ts";
export type PreviewFile = { path: string; content: string; artifactId?: string };
export type PreviewProject = { key: string; files: PreviewFile[]; entry: string };
export type PreviewIssue = { file?: string; line?: number; message: string };
export const previewLimits = { files: 12, pathCharacters: codePathCharacters, fileCharacters: 100_000, totalCharacters: 300_000, logs: 80, logCharacters: 1200 } as const;
export const previewExtensions = ["html", "htm", "svg", "css", "js", "mjs", "cjs", "jsx", "ts", "tsx", "json"];
export function previewExtension(path: string): string { return path.split(".").at(-1)?.toLowerCase() || ""; }
export function previewable(language: string): boolean { return ["html", "svg", "css", "javascript", "js", "typescript", "ts", "jsx", "tsx", "react"].includes(language); }
export function previewPath(input: string): string {
  try { const path = codeFilePath(input); if (previewExtensions.includes(previewExtension(path))) return path; } catch { /* Report the original path below. */ }
  throw Error("Invalid file path: " + input.slice(0, previewLimits.pathCharacters));
}
export function previewEntry(path: string): boolean { return ["html", "htm", "svg", "js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(previewExtension(path)); }
export function validatePreviewProject(project: PreviewProject): PreviewProject {
  if (!Array.isArray(project.files) || !project.files.length || project.files.length > previewLimits.files) throw Error("Use 1–12 preview files.");
  const paths = new Set<string>(); let total = 0;
  const files = project.files.map(file => {
    const path = previewPath(file.path);
    if (paths.has(path)) throw Error("Duplicate file: " + path);
    paths.add(path);
    if (typeof file.content !== "string" || file.content.includes("\u0000") || file.content.length > previewLimits.fileCharacters) throw Error("File exceeds 100,000 text characters: " + path);
    total += file.content.length;
    return { path, content: file.content, ...(file.artifactId ? { artifactId: file.artifactId } : {}) };
  });
  if (total > previewLimits.totalCharacters) throw Error("The preview exceeds 300,000 text characters.");
  const entry = previewPath(project.entry);
  if (!paths.has(entry) || !previewEntry(entry)) throw Error("Choose an HTML, JavaScript or React/TypeScript entry file.");
  return { key: project.key.slice(0, 200), entry, files };
}
export function previewSignature(project: Pick<PreviewProject, "entry" | "files">): string { return JSON.stringify([project.entry, project.files.map(file => [file.path, file.content])]); }

export function artifactProject(artifact: Artifact, artifacts: Artifact[]): PreviewProject {
  const key = artifact.messageId || artifact.id;
  const grouped = artifact.messageId ? artifacts.filter(item => item.messageId === artifact.messageId && item.kind === "code" && (previewable(item.language) || item.language === "json")) : [artifact];
  const used = new Set<string>(), explicitPaths = new Set(grouped.filter(item => item.filenameExplicit).map(item => item.filename));
  const files = grouped.map(item => {
    const ext = item.language === "javascript" ? "js" : item.language === "typescript" ? "ts" : item.language === "react" ? "jsx" : item.language;
    const fallback = ext === "html" ? "index.html" : ext === "css" ? "styles.css" : ["jsx", "tsx"].includes(ext) ? `App.${ext}` : ext === "json" ? "data.json" : `script.${ext}`;
    let path = item.filenameExplicit ? item.filename : fallback;
    // Explicit source paths must reach validation unchanged. Renaming them here
    // silently breaks imports; invalid paths receive a diagnostic on Run.
    if (!item.filenameExplicit) path = previewPath(fallback);
    if (!item.filenameExplicit) { let index = 2; const base = path; while (used.has(path) || explicitPaths.has(path)) { path = base.replace(/(\.[^.]+)$/, `-${index++}$1`); } }
    used.add(path); return { path, content: item.content, artifactId: item.id };
  });
  const html = files.find(file => ["html", "htm", "svg"].includes(previewExtension(file.path)));
  const component = files.find(file => ["tsx", "jsx"].includes(previewExtension(file.path)));
  const selected = files.find(file => file.artifactId === artifact.id);
  const selectedApp = selected && ["tsx", "jsx", "html", "htm", "svg"].includes(previewExtension(selected.path)) ? selected : null;
  return { key, files, entry: selectedApp?.path || html?.path || (selected && previewEntry(selected.path) ? selected.path : "") || component?.path || files.find(file => previewEntry(file.path))?.path || "" };
}

export function resolvePreviewPath(from: string, specifier: string, files: readonly { path: string }[]): string | null {
  if (/^[a-z]+:|^\/\//i.test(specifier)) return null;
  const clean = specifier.replace(/[?#].*$/, "").replace(/\\/g, "/");
  const pieces = (clean.startsWith("@/") ? clean.slice(2) : clean.startsWith("/") ? clean.slice(1) : from.split("/").slice(0, -1).concat(clean.split("/")).join("/")).split("/");
  const parts: string[] = [];
  for (const piece of pieces) { if (!piece || piece === ".") continue; if (piece === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(piece); }
  const base = parts.join("/"), extensions = ["tsx", "ts", "jsx", "js", "json", "css", "mjs", "cjs"];
  const candidates = [base, ...extensions.map(ext => `${base}.${ext}`), ...extensions.map(ext => `${base}/index.${ext}`), ...(/\.jsx?$/.test(base) ? [base.replace(/\.jsx?$/, ".tsx"), base.replace(/\.jsx?$/, ".ts")] : [])];
  return candidates.find(path => files.some(file => file.path === path)) || null;
}

export type PreviewEvent = { type: "ready" | "error" | "log"; level: string; text: string };
export function previewEvent(data: unknown, token: string): PreviewEvent | null {
  if (!data || typeof data !== "object") return null;
  const item = data as Record<string, unknown>;
  if (item.channel !== "aelvor-preview" || item.token !== token || !["ready", "error", "log"].includes(String(item.type))) return null;
  return { type: item.type as PreviewEvent["type"], level: ["error", "warn", "info", "log"].includes(String(item.level)) ? String(item.level) : "log", text: typeof item.text === "string" ? item.text.slice(0, previewLimits.logCharacters) : "" };
}
