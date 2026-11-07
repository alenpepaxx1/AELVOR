// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { webSourceUrl, extractWebText, fetchWebSource, webSourceResponse, webSourceLimits } from "../lib/web-sources.ts";
import { createKnowledgeDocument, createKnowledgeBackup, parseKnowledgeBackup, restoreKnowledgeExcerpts } from "../lib/knowledge-library.ts";
import { prepareConversation } from "../lib/conversation.ts";
import { runLocalAgent } from "../lib/local-agent.ts";
const signal = () => new AbortController().signal;
const html = text => new Response(text, { headers: { "Content-Type": "text/html; charset= utf-8" } });
test("web reader permits exact supported HTTPS hosts and rejects credentials, private hosts and lookalikes", () => {
  assert.equal(webSourceUrl("https://learn.microsoft.com/en-us/powershell/#topic").href, "https://learn.microsoft.com/en-us/powershell/");
  for (const url of ["http://learn.microsoft.com/page", "https://127.0.0.1/", "https://localhost/", "https://169.254.169.254/", "https://learn.microsoft.com.evil.test/", "https://evil.learn.microsoft.com/", "https://user:pass@nodejs.org/", "https://nodejs.org:444/", "https://nodejs.org/?access_token=secret", "https://nodejs.org\\@evil.test/", "https://nodejs.org/\npath", "https://nodejs.org/" + "界".repeat(100)]) assert.throws(() => webSourceUrl(url), /web_source_url/);
});
test("HTML extraction uses actual main text and excludes scripts, comments, navigation and hidden templates", () => {
  const source = '<html><head><title>Cedar &amp; Key</title><script>const fake="<main>BAD</main>"</script></head><body><nav>MENU</nav><!--<main>BAD COMMENT</main>--><main><h1>Cedar</h1><p title="a > b">A &lt; B &amp; C &#x1F600;</p><script>const fake="<script>BAD";</script><template><p>HIDDEN</p></template><p>Real ending.</p></main><footer>FOOTER</footer></body></html>';
  const value = extractWebText(source); assert.equal(value.title, "Cedar & Key");
  assert.match(value.content, /A < B & C 😀/); assert.match(value.content, /Real ending/); assert.doesNotMatch(value.content, /BAD|HIDDEN|MENU|FOOTER|const/);
});
test("HTML parser handles malformed text, quoted angle brackets and bounded numeric entities", () => {
  const value = extractWebText('<p data-value="<fake>">First &quot;word&quot;</p><p>Second &#0; &#x110000; &unknown;</p><!-- unfinished');
  assert.match(value.content, /First "word"/); assert.match(value.content, /Second � � &unknown;/); assert.doesNotMatch(value.content, /fake|unfinished/);
  assert.ok(extractWebText("<".repeat(20_000)).content.length === 0);
});
test("public page fetch omits caller credentials and keeps retrieval time separate from source date", async () => {
  const seen = []; const source = await fetchWebSource("https://docs.python.org/3/", signal(), async (url, options) => { seen.push({ url, options }); return html("<title>Python notes</title><main><p>Python uses indentation.</p></main>"); }, 12345);
  assert.equal(source.retrievedAt, 12345); assert.equal(source.sourceDate, undefined); assert.equal(source.content, "Python uses indentation.");
  assert.equal(seen[0].options.credentials, "omit"); assert.equal(seen[0].options.redirect, "manual"); assert.equal(seen[0].options.headers.Authorization, undefined); assert.equal(seen[0].options.headers.Cookie, undefined);
});
test("redirects stay within the host allowlist and cannot turn the endpoint into an arbitrary proxy", async () => {
  let calls = 0;
  await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:47321/run" } }); }), /web_source_redirect/); assert.equal(calls, 1);
  const source = await fetchWebSource("https://nodejs.org/a", signal(), async url => url.pathname === "/a" ? new Response(null, { status: 301, headers: { location: "/b" } }) : new Response("Node reference", { headers: { "Content-Type": "text/plain" } }));
  assert.equal(source.sourceUrl, "https://nodejs.org/b");
  calls = 0; await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => { calls++; return new Response(null, { status: 302, headers: { location: "/again" } }); }), /web_source_redirect/); assert.equal(calls, 4);
});
test("reader bounds compressed/streamed bytes, rejects unsupported encodings/types and clips Unicode safely", async () => {
  for (const type of ["application/pdf", "image/png", "text/html; charset=iso-8859-1"]) await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => new Response("text", { headers: { "Content-Type": type } })), /web_source_format/);
  await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => new Response("x".repeat(webSourceLimits.bytes + 1), { headers: { "Content-Type": "text/plain" } })), /web_source_size/);
  await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => new Response(new Uint8Array([255]), { headers: { "Content-Type": "text/plain" } })), /web_source_format/);
  const source = await fetchWebSource("https://nodejs.org/", signal(), async () => new Response("x".repeat(39999) + "😀end", { headers: { "Content-Type": "text/plain" } }));
  assert.equal(source.shortened, true); assert.ok(source.content.length <= 40000); assert.ok(source.content.isWellFormed());
});
test("same-origin web API validates before fetching and forwards no browser session headers", async () => {
  let calls = 0; const fetcher = async (_url, options) => { calls++; assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Authorization, undefined); return html("<main>Cedar encryption uses Boreal.</main>"); };
  const request = (origin, body) => new Request("https://aelvor.test/api/knowledge/web", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: "private", Authorization: "secret" }, body: JSON.stringify(body) });
  assert.equal((await webSourceResponse(request("https://evil.test", { url: "https://nodejs.org/" }), fetcher)).status, 403); assert.equal(calls, 0);
  assert.equal((await webSourceResponse(request("https://aelvor.test", { url: "https://127.0.0.1/" }), fetcher)).status, 400); assert.equal(calls, 0);
  const response = await webSourceResponse(request("https://aelvor.test", { url: "https://nodejs.org/" }), fetcher); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(calls, 1);
});
test("aborted requests and inaccessible sources do not become successful empty documents", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(fetchWebSource("https://nodejs.org/", controller.signal, async () => { calls++; return html("text"); }), { name: "AbortError" }); assert.equal(calls, 0);
  await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => html("<script>nothing readable</script>")), /web_source_empty/);
  await assert.rejects(fetchWebSource("https://nodejs.org/", signal(), async () => new Response("blocked", { status: 403 })), /web_source_download/);
});
test("web provenance survives backups, generated context and deterministic extraction with saved-text line scope", async () => {
  const document = createKnowledgeDocument({ title: "Cedar web notes", content: "Cedar gateway uses Boreal encryption.\nRotate its key.", sourceUrl: "https://nodejs.org/", retrievedAt: 12345 }, "cedar", 14000);
  const [restored] = parseKnowledgeBackup(JSON.stringify(createKnowledgeBackup([document]))); assert.equal(restored.retrievedAt, 12345); assert.equal(restored.sourceDate, "");
  const prepared = prepareConversation({ text: "Explain Cedar encryption", locale: "en", knowledge: [restored] }); assert.equal(prepared.knowledge[0].retrievedAt, 12345); assert.match(prepared.messages.at(-1).content, /not original webpage line numbers/);
  assert.deepEqual(restoreKnowledgeExcerpts(prepared.knowledge), prepared.knowledge);
  const local = await runLocalAgent({ text: "Summarize Cedar", locale: "en", knowledge: [restored] }); assert.equal(local.knowledge[0].retrievedAt, 12345);
  assert.throws(() => createKnowledgeDocument({ ...document, retrievedAt: Infinity }, "bad"));
});
