// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createProjectScaffold, codeProjectGuide } from "../lib/project-scaffolds.ts";
import { codeProjectsBackup, parseCodeProjects } from "../lib/code-projects.ts";
import { codeProjectZip } from "../lib/project-zip.ts";
import { projectZipEntries } from "../lib/project-zip-import.ts";
import { enclosingProjectFolder, importSourceProject, localProjectEntries, projectImportLimits, readProjectBytes } from "../lib/project-import.ts";
import { githubProjectInput, githubProjectResponse, downloadGitHubProject } from "../lib/github-project.ts";
import { saveProjectLocally, shareProjectZip } from "../lib/project-export.ts";
const signal = () => new AbortController().signal;
const starter = () => createProjectScaffold("web", "Grüße Project", "com.example.app", "source", "en", 1);
const entry = (path, content, extra = {}) => { const bytes = new TextEncoder().encode(content); return { path, size: bytes.length, read: async () => bytes, ...extra }; };
const importEntries = (entries, extra = {}) => importSourceProject(entries, { name: "Imported", id: "imported", stripRoot: true, now: 1, ...extra }, signal());
function fixtureZip(files, deflate = true) {
  const script = 'import io,json,sys,zipfile\nx=json.load(sys.stdin); b=io.BytesIO()\nwith zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED if x["deflate"] else zipfile.ZIP_STORED) as z:\n for f in x["files"]:\n  i=zipfile.ZipInfo(f["path"]); i.compress_type=zipfile.ZIP_DEFLATED if x["deflate"] else zipfile.ZIP_STORED\n  if f.get("link"): i.create_system=3; i.external_attr=0o120777 << 16\n  z.writestr(i,f.get("text", "").encode("utf-8"))\nsys.stdout.buffer.write(b.getvalue())';
  const result = spawnSync("python", ["-c", script], { input: JSON.stringify({ files, deflate }), maxBuffer: 12 * 1024 * 1024, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr?.toString()); return new Uint8Array(result.stdout);
}

test("app ZIP export imports back with exact nested UTF-8 source and no execution", async () => {
  const original = starter(), entries = projectZipEntries(codeProjectZip(original)), imported = await importEntries(entries);
  assert.equal(imported.report.root, original.slug); assert.equal(imported.report.stripped, true);
  assert.deepEqual(imported.project.files, original.files); assert.equal(imported.project.target, "web");
  assert.equal(imported.report.skipped.length, 0);
});

test("real Python Deflate ZIPs preserve nested paths, source copyright and a configurable enclosing folder", async () => {
  const files = [{ path: "repo-main/src/main.py", text: '# Upstream copyright\nprint("Grüße 🌍")\n' }, { path: "repo-main/README.md", text: "# Readme\n" }];
  const entries = projectZipEntries(fixtureZip(files));
  const imported = await importEntries(entries); assert.deepEqual(imported.project.files, files.map(file => ({ path: file.path.slice(10), content: file.text })));
  const kept = await importEntries(entries, { stripRoot: false }); assert.equal(kept.project.files[0].path, files[0].path);
  assert.equal(imported.project.target, "python");
});

test("local folder inputs retain relative paths and handle a Unicode enclosing directory", async () => {
  const file = new File(['print("hello")\n'], "main.py", { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: "Meine Grüße/src/main.py" });
  const entries = localProjectEntries([file]); assert.equal(enclosingProjectFolder(entries), "Meine Grüße");
  const imported = await importEntries(entries); assert.equal(imported.project.files[0].path, "src/main.py");
  assert.equal(imported.project.files[0].content, 'print("hello")\n');
  assert.equal(localProjectEntries([new File(["x"], "index.ts")])[0].path, "index.ts");
});

test("dependencies, binaries, environment secrets, symlinks and bad encodings are reported and never read unnecessarily", async () => {
  let forbiddenReads = 0;
  const excluded = path => entry("root/" + path, "private", { read: async () => { forbiddenReads++; throw Error("Must not read"); } });
  const entries = [entry("root/src/main.custom", "unaltered source"), excluded("node_modules/a/index.js"), excluded(".git/config"), excluded("dist/bundle.js"), excluded("assets/icon.png"), excluded(".env"), excluded("id_rsa"), excluded("private.pem"), entry("root/.env.example", "TOKEN=example"), entry("root/link.py", "../outside", { link: true }), entry("root/legacy.txt", "", { read: async () => new Uint8Array([255]) }), entry("root/data.txt", "a\u0000b")];
  const result = await importEntries(entries); assert.equal(forbiddenReads, 0);
  assert.deepEqual(result.project.files.map(file => file.path), ["src/main.custom", ".env.example"]);
  assert.ok(result.report.skipped.some(file => file.reason === "link")); assert.ok(result.report.skipped.some(file => file.reason === "encoding"));
  const zip = projectZipEntries(fixtureZip([{ path: "repo/main.py", text: "print(1)" }, { path: "repo/link.py", text: "../../target", link: true }]));
  assert.equal((await importEntries(zip)).report.skipped[0].reason, "link");
});

test("large local dependency trees are skipped while the actual source project remains importable", async () => {
  const dependencies = Array.from({ length: 4000 }, (_, i) => entry(`project/node_modules/p${i}/index.js`, "ignored", { read: async () => assert.fail("Dependency was read") }));
  const result = await importEntries([...dependencies, entry("project/src/main.py", "print(42)")]);
  assert.equal(result.project.files.length, 1); assert.equal(result.report.examined, 4001); assert.equal(result.report.skipped.length, 4000);
});

test("source and byte limits fail atomically without truncating files or accepting path collisions", async () => {
  await assert.rejects(importEntries(Array.from({ length: 121 }, (_, i) => entry(`root/file${i}.py`, "x"))), /project_import_limit/);
  await assert.rejects(importEntries([entry("root/Main.py", "x"), entry("root/main.py", "y")]), /code_project_duplicate/);
  await assert.rejects(importEntries([entry("root/.env", "secret")]), /project_import_empty/);
  const large = await importEntries([entry("root/main.py", "ok"), entry("root/large.txt", "", { size: projectImportLimits.fileBytes + 1, read: () => assert.fail("Oversized file was read") })]);
  assert.equal(large.report.skipped[0].reason, "size");
  const repeated = new Uint8Array(projectImportLimits.fileBytes);
  await assert.rejects(importEntries(Array.from({ length: 18 }, (_, i) => entry(`root/data${i}.txt`, "", { size: repeated.length, read: async () => repeated }))), /project_import_size/);
});

test("imported projects keep conservative build guidance after backup and preserve UTF-8 BOM bytes", async () => {
  const content = '\ufeff# Third-party notice\nprint("hello")\n';
  const imported = await importEntries([entry("project/run.py", content)]);
  assert.equal(imported.project.files[0].content, content); assert.equal(imported.project.imported, true);
  const restored = parseCodeProjects(JSON.stringify(codeProjectsBackup([imported.project])))[0];
  for (const locale of ["en", "de"]) {
    const guide = codeProjectGuide(restored, locale); assert.deepEqual(guide.commands, []);
    assert.match(guide.note, /README/); assert.doesNotMatch(guide.note, /python -m app.main/);
  }
});

test("ZIP traversal, encryption, split metadata and malformed archives are rejected", () => {
  for (const path of ["../main.py", "root/../main.py", "/etc/secret", "C:/main.py", "root\\..\\main.py"]) assert.throws(() => projectZipEntries(fixtureZip([{ path, text: "x" }])), /project_import_unsafe_path/);
  assert.throws(() => projectZipEntries(new Uint8Array([0, 1, 2])), /project_zip_invalid/);
  const encrypted = codeProjectZip(starter()), view = new DataView(encrypted.buffer); view.setUint16(6, 1, true);
  const central = view.getUint32(encrypted.length - 6, true); view.setUint16(central + 8, 1, true);
  assert.throws(() => projectZipEntries(encrypted), /project_zip_unsupported/);
  const split = codeProjectZip(starter()); new DataView(split.buffer).setUint16(split.length - 18, 1, true); assert.throws(() => projectZipEntries(split), /project_zip_invalid/);
});

test("ZIP checksums and expansion bounds reject damaged payloads and false expansion sizes", async () => {
  const broken = fixtureZip([{ path: "root/main.py", text: "print(1)" }], false), view = new DataView(broken.buffer);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true); broken[start] ^= 1;
  await assert.rejects(importEntries(projectZipEntries(broken)), /project_zip_corrupt/);
  const bomb = fixtureZip([{ path: "root/main.py", text: "x".repeat(100000) }]), bombView = new DataView(bomb.buffer), central = bombView.getUint32(bomb.length - 6, true);
  bombView.setUint32(22, 1, true); bombView.setUint32(central + 24, 1, true);
  await assert.rejects(importEntries(projectZipEntries(bomb)), /project_import_size/);
});

test("byte reads stop oversized streams and cancellation interrupts a pending read", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); }, cancel() { cancelled = true; } });
  await assert.rejects(readProjectBytes(stream, 10, signal()), /project_import_size/); assert.equal(cancelled, true);
  const controller = new AbortController(), waiting = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = readProjectBytes(waiting, 10, controller.signal); controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  const before = new AbortController(); before.abort(); await assert.rejects(importSourceProject([entry("a.py", "x")], { name: "x", id: "x", stripRoot: true }, before.signal), { name: "AbortError" });
});

test("GitHub URL/ref parsing allows real repository forms and rejects arbitrary hosts and credentials", () => {
  for (const url of ["https://github.com/Alen/app", "github.com/Alen/app.git", "Alen/app"]) assert.deepEqual(githubProjectInput(url), { owner: "Alen", repository: "app", ref: "" });
  assert.equal(githubProjectInput("https://github.com/Alen/app/tree/feature/mobile").ref, "feature/mobile");
  assert.equal(githubProjectInput("Alen/app", "v1.2.3").ref, "v1.2.3");
  assert.equal(githubProjectInput("https://github.com/Alen/app/tree/feature/Gr%C3%BC%C3%9Fe%231").ref, "feature/Grüße#1");
  for (const url of ["http://github.com/Alen/app", "https://github.com.evil.test/Alen/app", "https://user:secret@github.com/Alen/app", "https://127.0.0.1/private/app", "https://github.com/Alen/app/blob/main/file.py", "https://github.com:444/Alen/app"]) assert.throws(() => githubProjectInput(url), /github_url/);
  for (const ref of ["../secret", "a//b", "a.lock", "/absolute", "a b", "a@{b", "@", "a[b", "a\\b"]) assert.throws(() => githubProjectInput("Alen/app", ref), /github_ref/);
});

test("GitHub downloads follow only fixed provider hosts with bounded bytes and no forwarded credentials", async () => {
  const archive = codeProjectZip(starter()), calls = [];
  const fetcher = async (url, options) => { calls.push({ url: String(url), options }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://codeload.github.com/Alen/app/legacy.zip/main" } }) : new Response(archive); };
  assert.deepEqual(await downloadGitHubProject(githubProjectInput("Alen/app", "feature/mobile"), signal(), fetcher), archive);
  assert.match(calls[0].url, /feature%2Fmobile/); assert.equal(calls[0].options.redirect, "manual"); assert.equal(calls[0].options.credentials, "omit");
  assert.ok(!Object.keys(calls[0].options.headers).some(key => /authorization|cookie/i.test(key)));
  await assert.rejects(downloadGitHubProject(githubProjectInput("Alen/app"), signal(), async () => new Response(null, { status: 302, headers: { location: "https://evil.test/leak" } })), /github_redirect/);
  await assert.rejects(downloadGitHubProject(githubProjectInput("Alen/app"), signal(), async () => new Response("x", { headers: { "content-length": String(projectImportLimits.archiveBytes + 1) } })), /project_import_size/);
  for (const [status, code] of [[404, "github_not_found"], [403, "github_rate_limit"], [429, "github_rate_limit"], [500, "github_download"]]) await assert.rejects(downloadGitHubProject(githubProjectInput("Alen/app"), signal(), async () => new Response(null, { status })), new RegExp(code));
});

test("GitHub API accepts same-origin explicit POSTs, validates bodies and never fetches arbitrary URLs", async () => {
  const origin = "https://app.example", url = origin + "/api/projects/github", archive = codeProjectZip(starter()); let calls = 0;
  const fetcher = async () => { calls++; return new Response(archive); };
  const request = (body, originHeader = origin) => new Request(url, { method: "POST", headers: { Origin: originHeader, "Content-Type": "application/json" }, body });
  const valid = await githubProjectResponse(request(JSON.stringify({ url: "Alen/app" })), fetcher);
  assert.equal(valid.status, 200); assert.match(valid.headers.get("cache-control"), /private, no-store/); assert.deepEqual(new Uint8Array(await valid.arrayBuffer()), archive); assert.equal(calls, 1);
  assert.equal((await githubProjectResponse(request('{"url":"Alen/app"}', "https://evil.test"), fetcher)).status, 403);
  assert.equal((await githubProjectResponse(request("{"), fetcher)).status, 400);
  assert.equal((await githubProjectResponse(request('{"url":"https://evil.test/app"}'), fetcher)).status, 400);
  assert.equal((await githubProjectResponse(request("x".repeat(2049)), fetcher)).status, 413);
  assert.equal(calls, 1);
});

test("GitHub API aborts a stalled download at its deadline and never retries the request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] }); let calls = 0;
  const request = new Request("https://app.example/api/projects/github", { method: "POST", headers: { Origin: "https://app.example" }, body: '{"url":"Alen/app"}' });
  const pending = githubProjectResponse(request, async (_url, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })); });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  context.mock.timers.tick(projectImportLimits.timeoutMs);
  const result = await pending; assert.equal(result.status, 504); assert.equal((await result.json()).error, "github_timeout"); assert.equal(calls, 1);
});

test("local ZIP save reports success only after close and preserves cancellation/failure without replay", async () => {
  const project = starter(), received = []; let release;
  const closed = new Promise(resolve => { release = resolve; }); let completed = false;
  const saving = saveProjectLocally(project, { pick: async options => { assert.equal(options.suggestedName, project.slug + ".zip"); return { createWritable: async () => ({ write: async file => received.push(file), close: () => closed }) }; }, download() { assert.fail("No fallback write allowed"); } }).then(value => { completed = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false); release(); assert.equal(await saving, "saved");
  assert.deepEqual(new Uint8Array(await received[0].arrayBuffer()), codeProjectZip(project));
  assert.equal(await saveProjectLocally(project, { pick: async () => { throw new DOMException("cancelled", "AbortError"); }, download() { assert.fail(); } }), "cancelled");
  let aborted = false;
  await assert.rejects(saveProjectLocally(project, { pick: async () => ({ createWritable: async () => ({ write: async () => { throw Error("disk full"); }, close: async () => assert.fail(), abort: async () => { aborted = true; } }) }), download() { assert.fail(); } }), /project_export_save/); assert.equal(aborted, true);
  assert.equal(await saveProjectLocally(project, { download(blob, name) { assert.ok(blob.size); assert.equal(name, project.slug + ".zip"); } }), "download-started");
});

test("device sharing handles ZIP support, cancellation and handoff without claiming a Drive upload", async () => {
  const project = starter(); let shared = 0;
  const environment = { download() { assert.fail("No automatic download on share failure"); }, canShare: data => data.files[0].type === "application/zip", share: async data => { shared++; assert.equal(data.files[0].name, project.slug + ".zip"); } };
  assert.equal(await shareProjectZip(project, environment), "shared"); assert.equal(shared, 1);
  assert.equal(await shareProjectZip(project, { ...environment, canShare: () => false }), "unsupported"); assert.equal(shared, 1);
  assert.equal(await shareProjectZip(project, { ...environment, share: async () => { throw new DOMException("cancelled", "AbortError"); } }), "cancelled");
  await assert.rejects(shareProjectZip(project, { ...environment, share: async () => { throw Error("blocked"); } }), /project_export_share/);
});
