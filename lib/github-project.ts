// Copyright © 2026 Alen Pepa
import { projectImportLimits, readProjectBytes } from "./project-import.ts";
import { discardResponse, fetchWithAbort } from "./abortable-fetch.ts";
export type GitHubProject = { owner: string; repository: string; ref: string };
export function githubProjectInput(input: string, branch = ""): GitHubProject {
  if (typeof input !== "string" || input.length > 600 || typeof branch !== "string" || branch.length > 200) throw Error("github_url");
  let url: URL; try { url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${/^github\.com\//i.test(input.trim()) ? "" : "github.com/"}${input.trim()}`); } catch { throw Error("github_url"); }
  const parts = url.pathname.replace(/\/+$/, "").slice(1).split("/"), owner = parts[0], repository = (parts[1] || "").replace(/\.git$/i, "");
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || !/^[a-z0-9-]{1,100}$/i.test(owner || "") || !/^[a-z0-9_.-]{1,100}$/i.test(repository) || [".", ".."].includes(repository) || parts.length > 2 && (parts[2] !== "tree" || parts.length < 4)) throw Error("github_url");
  let ref: string; try { ref = branch.trim() || decodeURIComponent(parts.slice(3).join("/")); } catch { throw Error("github_ref"); }
  if (ref && (ref.length > 200 || /[\u0000-\u0020\u007f~^:?*\[\\]/.test(ref) || ref === "@" || ref.includes("@{") || ref.includes("..") || ref.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock")))) throw Error("github_ref");
  return { owner, repository, ref };
}
export async function downloadGitHubProject(project: GitHubProject, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  let url = new URL(`https://api.github.com/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repository)}/zipball${project.ref ? "/" + encodeURIComponent(project.ref) : ""}`);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetchWithAbort(url, { redirect: "manual", credentials: "omit", cache: "no-store", headers: { Accept: "application/vnd.github+json", "User-Agent": "AELVOR-source-import", "X-GitHub-Api-Version": "2026-03-10" } }, signal, fetcher);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); discardResponse(response); if (!location) throw Error("github_download");
      const next = new URL(location, url);
      if (next.protocol !== "https:" || next.port || next.username || next.password || !["api.github.com", "codeload.github.com"].includes(next.hostname)) throw Error("github_redirect");
      url = next; continue;
    }
    if (!response.ok) { discardResponse(response); throw Error(response.status === 404 ? "github_not_found" : [403, 429].includes(response.status) ? "github_rate_limit" : "github_download"); }
    const length = response.headers.get("content-length"); if (length && Number(length) > projectImportLimits.archiveBytes) { discardResponse(response); throw Error("project_import_size"); }
    return readProjectBytes(response.body, projectImportLimits.archiveBytes, signal);
  }
  throw Error("github_redirect");
}
export async function githubProjectResponse(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, error = (code: string, status: number) => Response.json({ error: code }, { status, headers });
  if (request.method !== "POST") return error("method_not_allowed", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin) return error("invalid_origin", 403);
  const controller = new AbortController(), abort = () => controller.abort(); request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) controller.abort();
  const timer = setTimeout(abort, projectImportLimits.timeoutMs);
  try {
    const bytes = await readProjectBytes(request.body, 2048, controller.signal);
    let input: unknown; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error("github_url", 400); }
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as Record<string, unknown>).url !== "string" || (input as Record<string, unknown>).ref !== undefined && typeof (input as Record<string, unknown>).ref !== "string") return error("github_url", 400);
    const data = input as { url: string; ref?: string }, project = githubProjectInput(data.url, data.ref), archive = await downloadGitHubProject(project, controller.signal, fetcher);
    return new Response(archive as Uint8Array<ArrayBuffer>, { headers: { ...headers, "Content-Type": "application/zip" } });
  } catch (caught) {
    const key = caught instanceof Error ? caught.message : "github_download";
    if (controller.signal.aborted) return error("github_timeout", 504);
    return error(["github_url", "github_ref", "github_not_found", "github_rate_limit", "github_redirect", "github_download", "project_import_size"].includes(key) ? key : "github_download", ["github_url", "github_ref"].includes(key) ? 400 : key === "github_not_found" ? 404 : key === "project_import_size" ? 413 : key === "github_rate_limit" ? 429 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
