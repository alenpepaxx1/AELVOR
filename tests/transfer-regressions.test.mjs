// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { githubProjectInput } from "../lib/github-project.ts";
import { importSourceProject, readProjectBytes } from "../lib/project-import.ts";
import { projectZipEntries } from "../lib/project-zip-import.ts";
const Transfers = await loadComponent(new URL("../app/project-transfers.tsx", import.meta.url));
const entry = (path, text, extra = {}) => { const bytes = new TextEncoder().encode(text); return { path, size: bytes.length, read: async () => bytes, ...extra }; };
const importEntries = entries => importSourceProject(entries, { name: "Imported", id: "imported", stripRoot: true, now: 1 }, new AbortController().signal);
function zip(files) {
  const result = spawnSync("python", ["-c", 'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for f in json.load(sys.stdin):\n  i=zipfile.ZipInfo(f["path"]); i.compress_type=zipfile.ZIP_DEFLATED\n  if f.get("directory"): i.create_system=3; i.external_attr=(0o40755 << 16) | 0x10\n  z.writestr(i,f.get("text", ""))\nsys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(files), timeout: 10000 });
  assert.equal(result.status, 0, result.stderr?.toString()); return new Uint8Array(result.stdout);
}

test("GitHub shorthand hosts are case-insensitive, including uppercase .GIT clone suffixes", () => {
  for (const text of ["GitHub.com/Alen/App", "GITHUB.COM/Alen/App.GIT", "https://GITHUB.COM/Alen/App.git"]) assert.deepEqual(githubProjectInput(text), { owner: "Alen", repository: "App", ref: "" });
});

test("Windows separators and directory attributes do not turn ZIP directories into source files", async () => {
  const files = [{ path: "Project\\", directory: true }, { path: "Project\\src", directory: true }, { path: "Project\\src\\main.py", text: "print(42)\n" }, { path: "Project\\README.md", text: "# Upstream\n" }];
  const result = await importEntries(projectZipEntries(zip(files)));
  assert.deepEqual(result.project.files.map(file => file.path), ["src/main.py", "README.md"]);
  assert.equal(result.project.files[0].content, "print(42)\n");
});

test("harmless current-directory ZIP prefixes import while parent traversal remains forbidden", async () => {
  const result = await importEntries(projectZipEntries(zip([{ path: "./", directory: true }, { path: "./Project/src/main.py", text: "print(1)" }])));
  assert.equal(result.project.files[0].path, "src/main.py");
  for (const path of ["./../outside.py", "./Project/../outside.py", ".\\..\\outside.py"]) assert.throws(() => projectZipEntries(zip([{ path, text: "x" }])), /project_import_unsafe_path/);
});

test("corrupt Deflate data reaches a ZIP corruption diagnostic instead of a generic network failure", async () => {
  const broken = zip([{ path: "Project/main.py", text: "print(42)\n" }]), view = new DataView(broken.buffer);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true); broken[start] = 0xff;
  await assert.rejects(importEntries(projectZipEntries(broken)), /project_zip_corrupt/);
});

test("cancellation and byte caps settle even when a stream's cancel callback never resolves", async () => {
  for (const kind of ["abort", "limit"]) {
    const controller = new AbortController();
    const stream = new ReadableStream({ start(source) { if (kind === "limit") source.enqueue(new Uint8Array(11)); }, cancel() { return new Promise(() => {}); } });
    const read = readProjectBytes(stream, 10, controller.signal).then(() => "success", error => kind === "abort" ? error.name : error.message);
    if (kind === "abort") controller.abort();
    const result = await Promise.race([read, new Promise(resolve => setImmediate(() => setImmediate(() => resolve("still-pending"))))]);
    assert.equal(result, kind === "abort" ? "AbortError" : "project_import_size");
  }
});

test("private-key files and JSON credentials are excluded while public keys and documentation stay intact", async () => {
  const key = "-----BEGIN EC PRIVATE KEY-----\nSYNTHETIC-TEST-DATA\n-----END EC PRIVATE KEY-----\n";
  const source = [entry("Project/main.py", "print(1)"), entry("Project/id_ecdsa", key, { read: () => assert.fail("Named private key must not be read") }), entry("Project/.ssh/config", "host example", { read: () => assert.fail("Private directory must not be read") }), entry("Project/renamed.txt", key), entry("Project/account.json", JSON.stringify({ type: "service_account", private_key: key })), entry("Project/public.pub", "-----BEGIN PUBLIC KEY-----\nSYNTHETIC\n-----END PUBLIC KEY-----"), entry("Project/README.md", "# Example\n```text\n" + key + "```"), entry("Project/.env.example", "TOKEN=example")];
  const result = await importEntries(source);
  assert.deepEqual(result.project.files.map(file => file.path), ["main.py", "public.pub", "README.md", ".env.example"]);
  assert.equal(result.report.skipped.filter(file => file.reason === "private").length, 4);
});

for (const locale of ["en", "de"]) test(`${locale}: technical inputs disable mobile capitalization, correction and spelling`, () => {
  const html = renderToStaticMarkup(createElement(Transfers, { locale, canImport: true, onImport() {} }));
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]).filter(input => !/type="file"/.test(input));
  assert.equal(inputs.length, 2);
  for (const input of inputs) { assert.match(input, /autoCapitalize="none"/); assert.match(input, /autoCorrect="off"/); assert.match(input, /spellCheck="false"/); }
});
