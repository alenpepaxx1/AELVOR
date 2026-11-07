// Copyright © 2026 Alen Pepa
import { readProjectBytes } from "./project-import.ts";
import { discardResponse, fetchWithAbort } from "./abortable-fetch.ts";
export const webSourceHosts = ["learn.microsoft.com", "docs.python.org", "nodejs.org", "developer.mozilla.org", "developer.chrome.com", "react.dev", "www.typescriptlang.org", "owasp.org", "cheatsheetseries.owasp.org", "docs.github.com", "git-scm.com", "developer.android.com", "developer.apple.com", "docs.flutter.dev", "www.rfc-editor.org", "en.wikipedia.org", "de.wikipedia.org"] as const;
export const webSourceLimits = { bytes: 1_048_576, characters: 40_000, timeoutMs: 20_000, redirects: 3 } as const;
export type WebSource = { title: string; content: string; sourceUrl: string; retrievedAt: number; shortened: boolean };
export function webSourceUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u0020\u007f\\]/.test(value)) throw Error("web_source_url");
  let url: URL; try { url = new URL(value); } catch { throw Error("web_source_url"); }
  if (url.protocol !== "https:" || url.href.length > 500 || url.port || url.username || url.password || !webSourceHosts.includes(url.hostname as typeof webSourceHosts[number]) || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) throw Error("web_source_url");
  url.hash = ""; return url;
}
function entities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
  return text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,12});/gi, (whole, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? whole;
    const code = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}
// Bounded text extraction, never HTML rendering. Tag scanning respects quoted
// attributes; executable/hidden regions and comments contribute no source text.
export function extractWebText(html: string) {
  const input = html, lower = html.toLowerCase();
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]{0,1000}?)<\/title\s*>/i.exec(html);
  const blocked = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "head", "nav", "footer"]), breaks = new Set(["p", "div", "article", "section", "main", "br", "li", "tr", "h1", "h2", "h3", "h4", "pre", "blockquote"]);
  const hidden: string[] = []; let output = "", mainOutput = "", mainDepth = 0, sawMain = false, index = 0;
  const append = (text: string) => { output += text; if (mainDepth > 0) mainOutput += text; };
  while (index < input.length) {
    if (hidden.length && ["script", "style", "noscript"].includes(hidden[hidden.length - 1])) { const closing = lower.indexOf("</" + hidden[hidden.length - 1], index); if (closing < 0) break; index = closing; }
    if (input[index] !== "<") { const end = input.indexOf("<", index), high = end < 0 ? input.length : end; if (!hidden.length) append(input.slice(index, high)); index = high; continue; }
    if (input.startsWith("<!--", index)) { const end = input.indexOf("-->", index + 4); index = end < 0 ? input.length : end + 3; continue; }
    let end = index + 1, quote = "";
    for (; end < input.length && end - index <= 8192; end++) { const char = input[end]; if (quote) { if (char === quote) quote = ""; } else if (char === '"' || char === "'") quote = char; else if (char === ">") break; }
    if (end >= input.length || end - index > 8192) { index = end; continue; }
    const tag = /^<\s*(\/?)\s*([a-z][a-z\d-]*)\b/i.exec(input.slice(index, end + 1));
    if (tag) {
      const name = tag[2].toLowerCase();
      if (blocked.has(name)) { if (!tag[1] && !/\/\s*>$/.test(input.slice(index, end + 1))) hidden.push(name); else if (tag[1]) { const position = hidden.lastIndexOf(name); if (position >= 0) hidden.splice(position); } }
      if (!hidden.length && name === "main") { if (!tag[1]) { mainDepth++; sawMain = true; } else mainDepth = Math.max(0, mainDepth - 1); }
      if (!hidden.length && breaks.has(name)) append("\n");
    }
    index = end + 1;
  }
  return { title: entities((titleMatch?.[1] || "").replace(/<[^>]*>/g, "")).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120), content: entities(sawMain ? mainOutput : output).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim() };
}
export async function fetchWebSource(input: string, signal: AbortSignal, fetcher: typeof fetch = fetch, now = Date.now()): Promise<WebSource> {
  let url = webSourceUrl(input);
  for (let redirects = 0; redirects <= webSourceLimits.redirects; redirects++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetchWithAbort(url, { redirect: "manual", credentials: "omit", cache: "no-store", headers: { Accept: "text/html,text/plain,text/markdown;q=0.9", "User-Agent": "AELVOR-reference-reader/1.0" } }, signal, fetcher);
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get("location"); discardResponse(response); if (!location) throw Error("web_source_redirect"); try { url = webSourceUrl(new URL(location, url).href); } catch { throw Error("web_source_redirect"); } continue; }
    if (!response.ok) { discardResponse(response); throw Error(response.status === 429 ? "web_source_rate_limit" : "web_source_download"); }
    const type = response.headers.get("content-type") || "", charset = /charset\s*=\s*["\']?([^;"\'\s]+)/i.exec(type)?.[1];
    if (!/^(?:text\/(?:html|plain|markdown)|application\/json)(?:;|$)/i.test(type) || (charset && !/^utf-?8$/i.test(charset))) { discardResponse(response); throw Error("web_source_format"); }
    const size = response.headers.get("content-length"); if (size && Number(size) > webSourceLimits.bytes) { discardResponse(response); throw Error("web_source_size"); }
    let bytes: Uint8Array; try { bytes = await readProjectBytes(response.body, webSourceLimits.bytes, signal); } catch (error) { if (signal.aborted) throw error; throw Error(error instanceof Error && error.message === "project_import_size" ? "web_source_size" : "web_source_download"); }
    let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw Error("web_source_format"); }
    const extracted = /^text\/html/i.test(type) ? extractWebText(text) : { title: "", content: text.replace(/\u0000/g, "") };
    if (!extracted.content.trim()) throw Error("web_source_empty");
    let end = Math.min(extracted.content.length, webSourceLimits.characters); if (/[\uD800-\uDBFF]/.test(extracted.content[end - 1] || "") && /[\uDC00-\uDFFF]/.test(extracted.content[end] || "")) end--;
    return { title: extracted.title || `${url.hostname}${url.pathname}`.slice(0, 120), content: extracted.content.slice(0, end), sourceUrl: url.href, retrievedAt: now, shortened: end < extracted.content.length };
  }
  throw Error("web_source_redirect");
}
export async function webSourceResponse(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }, fail = (error: string, status: number) => Response.json({ error }, { headers, status });
  if (request.method !== "POST") return fail("method_not_allowed", 405);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("invalid_origin", 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) return fail("web_source_media_type", 415);
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, webSourceLimits.timeoutMs);
  request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort();
  try {
    const bytes = await readProjectBytes(request.body, 2048, controller.signal); let value; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail("web_source_url", 400); }
    if (!value || typeof value.url !== "string") return fail("web_source_url", 400);
    return Response.json(await fetchWebSource(value.url, controller.signal, fetcher), { headers });
  } catch (error) { const key = error instanceof Error ? error.message : "web_source_download"; return fail(controller.signal.aborted ? "web_source_timeout" : key === "project_import_size" ? "web_source_request_size" : key === "project_import_read" ? "web_source_url" : ["web_source_url", "web_source_redirect", "web_source_format", "web_source_size", "web_source_empty", "web_source_rate_limit"].includes(key) ? key : "web_source_download", controller.signal.aborted ? 504 : key === "project_import_size" ? 413 : ["web_source_url", "project_import_read"].includes(key) ? 400 : key === "web_source_rate_limit" ? 429 : 502); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
