// Copyright © 2026 Alen Pepa
import { codeProjectZip } from "./project-zip.ts";
import type { CodeProject } from "./code-projects.ts";
export type ProjectExportEnvironment = {
  pick?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }> }>;
  canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void>;
  download: (blob: Blob, name: string) => void;
};
export function projectExportEnvironment(pickerHost: { showSaveFilePicker?: ProjectExportEnvironment["pick"] }, shareHost: Pick<ProjectExportEnvironment, "canShare" | "share">, download: ProjectExportEnvironment["download"]): ProjectExportEnvironment {
  const environment: ProjectExportEnvironment = { download };
  // Optional browser capabilities can be hidden by privacy/embedding policies.
  // Read them independently so a blocked share getter cannot break local save.
  try { const pick = pickerHost.showSaveFilePicker; if (typeof pick === "function") environment.pick = pick.bind(pickerHost); } catch { /* Use ordinary download. */ }
  try { const canShare = shareHost.canShare; if (typeof canShare === "function") environment.canShare = canShare.bind(shareHost); } catch { /* Sharing is unavailable. */ }
  try { const share = shareHost.share; if (typeof share === "function") environment.share = share.bind(shareHost); } catch { /* Sharing is unavailable. */ }
  return environment;
}
export function projectZipFile(project: CodeProject): File { return new File([codeProjectZip(project) as Uint8Array<ArrayBuffer>], `${project.slug}.zip`, { type: "application/zip" }); }
export async function saveProjectLocally(project: CodeProject, environment: ProjectExportEnvironment): Promise<"saved" | "download-started" | "cancelled"> {
  const file = projectZipFile(project);
  if (!environment.pick) { environment.download(file, file.name); return "download-started"; }
  try {
    const handle = await environment.pick({ suggestedName: file.name, types: [{ description: "ZIP project", accept: { "application/zip": [".zip"] } }] }), writable = await handle.createWritable();
    try { await writable.write(file); await writable.close(); }
    catch (error) {
      // Cleanup must neither hide the write error nor leave the UI waiting on
      // a stalled native abort. There is no automatic second write or download.
      try { void writable.abort?.().catch(() => {}); } catch { /* Retain the original failure. */ }
      throw error;
    }
    return "saved";
  } catch (error) { if (error instanceof Error && error.name === "AbortError") return "cancelled"; throw Error("project_export_save"); }
}
export async function shareProjectZip(project: CodeProject, environment: ProjectExportEnvironment): Promise<"shared" | "unsupported" | "cancelled"> {
  const file = projectZipFile(project), data = { files: [file], title: project.name };
  try { if (!environment.share || !environment.canShare?.({ files: [file] })) return "unsupported"; }
  catch { return "unsupported"; }
  try { await environment.share(data); return "shared"; } catch (error) { if (error instanceof Error && error.name === "AbortError") return "cancelled"; throw Error("project_export_share"); }
}
