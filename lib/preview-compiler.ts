// Copyright © 2026 Alen Pepa
import type { PreviewProject } from "./artifact-project.ts";
import type { CompiledPreview } from "./preview-compiler-core.ts";
export function compilePreview(project: PreviewProject, signal: AbortSignal, createWorker: () => Worker): Promise<CompiledPreview> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const worker = createWorker();
    const finish = (error?: Error, result?: CompiledPreview) => { clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate(); if (error) reject(error); else resolve(result!); };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(Error("Preview compilation timed out. Try a smaller project.")), 15_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => { if (event.data?.ok) finish(undefined, event.data.result); else finish(Error(event.data?.error || "Preview compilation failed.")); };
    worker.onerror = () => finish(Error("The preview compiler could not start. Reload the app and retry."));
    worker.onmessageerror = () => finish(Error("The preview compiler returned an unreadable response."));
    try { worker.postMessage(project); } catch { finish(Error("The preview compiler could not receive these files.")); }
  });
}
let cachedRuntime = "";
export async function loadPreviewRuntime(signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (cachedRuntime) return cachedRuntime;
  const response = await fetch("/preview/aelvor-preview-runtime.js", { signal, credentials: "same-origin" });
  if (!response.ok) throw Error("Preview runtime could not be loaded. Reload the app and retry.");
  const text = await response.text();
  if (text.length > 6_000_000 || !text.includes("AelvorPreviewRuntime")) throw Error("Invalid preview runtime.");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  cachedRuntime = text; return text;
}
