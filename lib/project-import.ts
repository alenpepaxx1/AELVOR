// Copyright © 2026 Alen Pepa
import { codeFilePath } from "./code-files.ts";
import { codeProjectLimits, detectCodeTarget, projectName, projectSlug, validateCodeProjects, type CodeProject } from "./code-projects.ts";
export const projectImportLimits = { archiveBytes: 10 * 1024 * 1024, expandedBytes: 8 * 1024 * 1024, entries: 3000, localEntries: 50_000, fileBytes: 480_000, timeoutMs: 30_000 } as const;
export type SourceEntry = { path: string; size: number; link?: boolean; read: (signal: AbortSignal) => Promise<Uint8Array> };
export type ImportSkipReason = "dependency" | "generated" | "binary" | "private" | "encoding" | "size" | "path" | "link";
export type ProjectImportReport = { examined: number; root: string; stripped: boolean; skipped: { path: string; reason: ImportSkipReason }[] };
export type ImportedProject = { project: CodeProject; report: ProjectImportReport };
export function checkImportAbort(signal: AbortSignal) { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); }
export async function readProjectBytes(stream: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  checkImportAbort(signal); if (!stream) throw Error("project_import_read");
  const reader = stream.getReader(), parts: Uint8Array[] = []; let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
  try { while (true) { const { done, value } = await reader.read(); checkImportAbort(signal); if (done) break; total += value.byteLength; if (total > maximum) throw Error("project_import_size"); parts.push(value); } }
  // Cancellation is best-effort cleanup. A provider's stalled cancel promise
  // must not prevent a timeout or byte-limit error from reaching the caller.
  catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
export function importRelativePath(input: string): string {
  const path = input.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (!path || path.length > 1024 || path.startsWith("/") || /^[a-z]:/i.test(path) || /[\u0000-\u001f\u007f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) throw Error("project_import_unsafe_path");
  return path;
}
export function enclosingProjectFolder(entries: SourceEntry[]): string {
  if (!entries.length) return "";
  const paths = entries.map(entry => importRelativePath(entry.path)), root = paths[0].split("/")[0];
  return paths.every(path => path.includes("/") && path.startsWith(root + "/")) ? root : "";
}
export function sourceSkipReason(path: string): ImportSkipReason | null {
  const parts = path.toLowerCase().split("/"), name = parts.at(-1)!;
  if (parts.some(part => [".ssh", ".aws", ".azure", ".gnupg"].includes(part))) return "private";
  if (parts.some(part => [".git", "node_modules", ".venv", "venv", "__pycache__", ".gradle", ".dart_tool", "pods"].includes(part))) return "dependency";
  if (parts.some(part => ["dist", "build", ".next", "coverage", "deriveddata", ".ds_store", "__macosx"].includes(part))) return "generated";
  if (/^\.env(?:\.|$)/.test(name) && !/\.(?:example|sample|template)$/.test(name) || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$|\.(?:pem|p12|pfx|key|keystore|jks)$/.test(name)) return "private";
  if (/\.(?:exe|dll|so|dylib|apk|ipa|jar|zip|gz|tgz|7z|rar|png|jpe?g|gif|webp|ico|icns|pdf|wasm|onnx|gguf|bin|pt|pth|safetensors|mp[34]|mov|woff2?|ttf|otf|o|a|class|pyc)$/i.test(name)) return "binary";
  return null;
}
const privateKeyHeader = /^-----BEGIN (?:(?:[A-Z0-9]+ )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/;
function privateSourceContent(path: string, content: string): boolean {
  if (privateKeyHeader.test(content.trimStart())) return true;
  if (/\.json$/i.test(path)) try {
    const value: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      return ["private_key", "privateKey"].some(key => Object.hasOwn(data, key) && typeof data[key] === "string" && privateKeyHeader.test(data[key].trimStart()));
    }
  } catch { /* Non-JSON source is still handled as ordinary UTF-8 text. */ }
  return false;
}
export function localProjectEntries(files: readonly File[]): SourceEntry[] {
  if (files.length > projectImportLimits.localEntries) throw Error("project_import_local_entries");
  return files.map(file => ({ path: importRelativePath(file.webkitRelativePath || file.name), size: file.size, read: signal => readProjectBytes(file.stream(), projectImportLimits.fileBytes, signal) }));
}
export async function importSourceProject(entries: SourceEntry[], options: { name: string; id: string; stripRoot: boolean; now?: number; onProgress?: (done: number, total: number) => void }, signal: AbortSignal): Promise<ImportedProject> {
  checkImportAbort(signal);
  if (entries.length > projectImportLimits.localEntries) throw Error("project_import_local_entries");
  const root = enclosingProjectFolder(entries), skipped: ProjectImportReport["skipped"] = [], files: CodeProject["files"] = []; let characters = 0, expanded = 0;
  for (const [index, entry] of entries.entries()) {
    checkImportAbort(signal); const raw = importRelativePath(entry.path), path = options.stripRoot && root ? raw.slice(root.length + 1) : raw;
    const rawRoot = raw.split("/")[0].toLowerCase();
    const reason = entry.link ? "link" : rawRoot === ".git" ? "dependency" : [".ssh", ".aws", ".azure", ".gnupg"].includes(rawRoot) ? "private" : sourceSkipReason(path);
    if (reason) { skipped.push({ path, reason }); continue; }
    try { codeFilePath(path); } catch { skipped.push({ path, reason: "path" }); continue; }
    if (entry.size > projectImportLimits.fileBytes) { skipped.push({ path, reason: "size" }); continue; }
    const bytes = await entry.read(signal); checkImportAbort(signal);
    expanded += bytes.byteLength; if (expanded > projectImportLimits.expandedBytes) throw Error("project_import_size");
    if (bytes.byteLength > projectImportLimits.fileBytes) throw Error("project_import_size");
    let content: string; try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { skipped.push({ path, reason: "encoding" }); continue; }
    if (content.includes("\u0000")) { skipped.push({ path, reason: "binary" }); continue; }
    if (privateSourceContent(path, content)) { skipped.push({ path, reason: "private" }); continue; }
    if (content.length > codeProjectLimits.fileCharacters) { skipped.push({ path, reason: "size" }); continue; }
    files.push({ path, content }); characters += content.length;
    if (files.length > codeProjectLimits.files || characters > codeProjectLimits.projectCharacters) throw Error("project_import_limit");
    options.onProgress?.(index + 1, entries.length);
  }
  if (!files.length) throw Error("project_import_empty");
  const now = options.now ?? Date.now(), name = projectName(options.name);
  const project = validateCodeProjects([{ id: options.id, name, slug: projectSlug(name), target: detectCodeTarget(files), imported: true, files, createdAt: now, updatedAt: now }])[0];
  return { project, report: { examined: entries.length, root, stripped: Boolean(options.stripRoot && root), skipped } };
}
