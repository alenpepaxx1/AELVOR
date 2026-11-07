// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
async function files(directory) { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat(); }
const assets = await files("dist/client"), javascript = assets.filter(path => path.endsWith(".js"));
const worker = "dist/client/preview/aelvor-preview-compiler.js";
assert.ok(assets.includes(worker), "The browser-only preview compiler must ship as a static asset");
assert.ok((await Promise.all(javascript.filter(path => path !== worker).map(path => readFile(path, "utf8")))).some(source => source.includes("/preview/aelvor-preview-compiler.js")), "The compiler must have a same-origin static worker URL");
assert.equal(await readFile(worker, "utf8"), await readFile("public/preview/aelvor-preview-compiler.js", "utf8"));
const serverAssets = await files("dist/server");
assert.ok(!serverAssets.some(path => /artifact-preview\.worker|aelvor-preview-compiler/.test(path)), "The browser compiler must not inflate the server package");
const serverBytes = (await Promise.all(serverAssets.map(async path => (await stat(path)).size))).reduce((sum, size) => sum + size, 0);
assert.ok(serverBytes < 63.9 * 1024 * 1024, "The deployment must fit the hosting Worker size limit");
const source = await readFile("public/preview/aelvor-preview-runtime.js", "utf8");
assert.equal(await readFile("dist/client/preview/aelvor-preview-runtime.js", "utf8"), source);
assert.equal(await readFile("dist/client/preview/THIRD_PARTY_NOTICES.txt", "utf8"), await readFile("public/preview/THIRD_PARTY_NOTICES.txt", "utf8"));
const context = vm.createContext({ console, setTimeout, clearTimeout, queueMicrotask });
const runtime = vm.runInContext(source + ";AelvorPreviewRuntime", context, { timeout: 2000 });
assert.equal(typeof runtime.requirePackage("react").createElement, "function");
assert.equal(typeof runtime.requirePackage("react-dom/client").createRoot, "function");
assert.ok(runtime.requirePackage("lucide-react").Monitor);
assert.throws(() => runtime.requirePackage("fs"), /Unavailable package/);
const thread = new Worker(new URL("./preview-worker-smoke-host.mjs", import.meta.url), { workerData: { entry: pathToFileURL(resolve(worker)).href } });
let timer;
try {
  const response = new Promise((resolve, reject) => { thread.once("message", resolve); thread.once("error", reject); });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Compiled preview worker timed out")), 15000); });
  thread.postMessage({ key: "smoke", entry: "App.tsx", files: [{ path: "App.tsx", content: 'import { useState } from "react"; export default function App(){const [count]=useState<number>(1);return <button>{count}</button>}' }] });
  const result = await Promise.race([response, timeout]);
  assert.equal(result.ok, true); assert.deepEqual(result.result.issues, []);
  assert.match(result.result.modules["App.tsx"], /createElement/);
  console.log("Shipped preview runtime, package APIs, licenses and compiled TSX worker verified. Browser layout and interaction remain unverified.");
} finally { clearTimeout(timer); await thread.terminate(); }
