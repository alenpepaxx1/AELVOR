// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { downloadGitHubProject, githubProjectResponse } from "../lib/github-project.ts";
import { projectImportLimits } from "../lib/project-import.ts";
import { fetchWebSource, webSourceLimits, webSourceResponse } from "../lib/web-sources.ts";
const tick = () => new Promise(resolve => setImmediate(resolve));
const observe = async promise => Promise.race([promise.then(value => ({ value }), error => ({ error })), tick().then(tick).then(() => ({ pending: true }))]);
const stalledBody = onCancel => new ReadableStream({ cancel() { onCancel(); return new Promise(() => {}); } });
const flows = [
  { name: "GitHub", run: (signal, fetcher) => downloadGitHubProject({ owner: "Alen", repository: "App", ref: "" }, signal, fetcher), success: () => new Response(new Uint8Array([1, 2])), redirect: "https://codeload.github.com/Alen/App/zip/main", route: githubProjectResponse, path: "/api/projects/github", body: '{"url":"Alen/App"}', timeout: projectImportLimits.timeoutMs, timeoutCode: "github_timeout", rejected: [{ status: 404, error: "github_not_found" }, { headers: { "content-length": String(projectImportLimits.archiveBytes + 1) }, error: "project_import_size" }] },
  { name: "Web source", run: (signal, fetcher) => fetchWebSource("https://docs.python.org/3/", signal, fetcher), success: () => new Response("Source text", { headers: { "content-type": "text/plain" } }), redirect: "https://docs.python.org/3/library/", route: webSourceResponse, path: "/api/knowledge/web", body: '{"url":"https://docs.python.org/3/"}', timeout: webSourceLimits.timeoutMs, timeoutCode: "web_source_timeout", rejected: [{ status: 429, error: "web_source_rate_limit" }, { headers: { "content-type": "image/png" }, error: "web_source_format" }, { headers: { "content-type": "text/plain", "content-length": String(webSourceLimits.bytes + 1) }, error: "web_source_size" }] },
];
for (const flow of flows) {
  test(`${flow.name}: cancellation settles a transport that ignores AbortSignal and closes its late response`, async () => {
    const controller = new AbortController(); let finish, calls = 0, cancelled = 0;
    const pending = flow.run(controller.signal, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    controller.abort(); const result = await observe(pending);
    assert.equal(result.error?.name, "AbortError"); assert.equal(calls, 1);
    finish(new Response(stalledBody(() => { cancelled++; }))); await tick();
    assert.equal(cancelled, 1); assert.equal(calls, 1);
    await assert.rejects(flow.run(controller.signal, () => assert.fail("Already aborted request started")), error => error.name === "AbortError");
  });

  test(`${flow.name}: redirects continue even if body cleanup never settles`, async () => {
    let calls = 0, cancelled = 0;
    const result = await observe(flow.run(new AbortController().signal, async () => ++calls === 1 ? new Response(stalledBody(() => { cancelled++; }), { status: 302, headers: { location: flow.redirect } }) : flow.success()));
    assert.equal(result.pending, undefined); assert.equal(result.error, undefined); assert.ok(result.value); assert.equal(calls, 2); assert.equal(cancelled, 1);
  });

  test(`${flow.name}: cleanup cannot hide HTTP, format or size failures`, async () => {
    for (const item of flow.rejected) {
      let cancelled = 0;
      const result = await observe(flow.run(new AbortController().signal, async () => new Response(stalledBody(() => { cancelled++; }), { status: item.status || 200, headers: item.headers })));
      assert.equal(result.error?.message, item.error); assert.equal(cancelled, 1);
    }
  });

  test(`${flow.name}: route deadlines terminate ignored fetch signals without retries`, async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] }); let calls = 0;
    const request = new Request("https://app.example" + flow.path, { method: "POST", headers: { Origin: "https://app.example", "Content-Type": "application/json" }, body: flow.body });
    const pending = flow.route(request, () => { calls++; return new Promise(() => {}); });
    await tick(); assert.equal(calls, 1); context.mock.timers.tick(flow.timeout);
    const result = await observe(pending); assert.equal(result.value?.status, 504); assert.equal((await result.value.json()).error, flow.timeoutCode); assert.equal(calls, 1);
  });

  test(`${flow.name}: a synchronous transport abort cannot be missed, and genuine transport errors remain errors`, async () => {
    const controller = new AbortController();
    const result = await observe(flow.run(controller.signal, () => { controller.abort(); return new Promise(() => {}); }));
    assert.equal(result.error?.name, "AbortError");
    const failure = new TypeError("Transport failed");
    await assert.rejects(flow.run(new AbortController().signal, async () => { throw failure; }), error => error === failure);
  });
}
