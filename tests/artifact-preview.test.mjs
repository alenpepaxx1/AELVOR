// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { artifactProject, previewEvent, previewSignature, previewable, resolvePreviewPath, validatePreviewProject } from "../lib/artifact-project.ts";
import { compilePreviewProject } from "../lib/preview-compiler-core.ts";
import { buildPreviewDocument, previewCsp } from "../lib/preview-document.ts";
import { extractArtifacts } from "../lib/local-tools.ts";
import { compilePreview } from "../lib/preview-compiler.ts";

const project = files => ({ key: "test-project", entry: files[0].path, files });
const fakeRuntime = `var AelvorPreviewRuntime = { React: { createElement: (type, props, ...children) => ({type, props, children}), Fragment: "fragment" }, ReactDOM: {}, requirePackage(name) { if(name === "react") return this.React; if(name === "react-dom/client") return {}; throw Error("Unavailable package: " + name); }, mount(component) { globalThis.mounted = component(); } };`;
function execute(result, parsed) {
  const messages = [], styles = [], handlers = {}, host = {};
  const document = { title: "", body: { innerHTML: "", setAttribute() {} }, documentElement: { setAttribute() {} }, head: { appendChild(node) { styles.push(node.textContent); } }, createElement() { return { textContent: "" }; }, getElementById() { return host; } };
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {}, info() {} }, document, parent: { postMessage(value) { messages.push(value); } }, requestAnimationFrame(callback) { callback(); }, addEventListener(name, listener) { handlers[name] = listener; }, DOMParser: class { parseFromString() { return parsed; } } });
  vm.runInContext("window = globalThis", context);
  const html = buildPreviewDocument(result, fakeRuntime, "test-token");
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(script, context, { timeout: 1000 });
  return { context, messages, styles, document, handlers, html };
}

test("named code fences form one project per assistant reply and preserve safe source filenames", () => {
  const text = '```html filename=index.html\n<div id="root"></div>\n```\n```css filename=styles.css\nbody{color:green}\n```\n```tsx filename=src/App.tsx\nexport default function App(){return <button>Hi</button>}\n```';
  const artifacts = extractArtifacts([{ id: "first", role: "assistant", content: text }, { id: "second", role: "assistant", content: text }]);
  const selected = artifacts.find(item => item.id === "first:2"), grouped = artifactProject(selected, artifacts);
  assert.deepEqual(grouped.files.map(file => file.path), ["index.html", "styles.css", "src/App.tsx"]);
  assert.equal(grouped.entry, "src/App.tsx"); assert.equal(grouped.key, "first");
  assert.equal(artifactProject(artifacts[0], artifacts).entry, "index.html");
  assert.equal(grouped.files.length, 3); assert.equal(artifacts[0].filenameExplicit, true);
  const unsafe = extractArtifacts([{ id: "unsafe", role: "assistant", content: '```tsx filename=../../App.tsx\nexport default ()=>null\n```' }])[0];
  assert.equal(unsafe.filename, "aelvor-1.tsx");
});

test("generic web snippets receive usable file paths while Python remains code-only", () => {
  const artifacts = extractArtifacts([{ id: "reply", role: "assistant", content: '```html\n<h1>Hello</h1>\n```\n```css\nh1{color:green}\n```\n```javascript\nconsole.log("ready")\n```' }]);
  const source = artifactProject(artifacts[0], artifacts);
  assert.deepEqual(source.files.map(file => file.path), ["index.html", "styles.css", "script.js"]);
  assert.equal(previewable("python"), false); assert.equal(previewable("tsx"), true);
  const pathFence = extractArtifacts([{ id: "path", role: "assistant", content: '```src/App.tsx\nexport default ()=>null\n```' }])[0];
  assert.equal(pathFence.filename, "src/App.tsx"); assert.equal(pathFence.language, "tsx");
});

test("virtual paths resolve relative components, JSON, CSS and index modules without filesystem escape", () => {
  const files = [{ path: "src/App.tsx" }, { path: "src/widgets/index.tsx" }, { path: "data.json" }, { path: "styles.css" }];
  assert.equal(resolvePreviewPath("src/App.tsx", "./widgets", files), "src/widgets/index.tsx");
  assert.equal(resolvePreviewPath("src/App.tsx", "../data.json", files), "data.json");
  assert.equal(resolvePreviewPath("src/App.tsx", "@/styles.css", files), "styles.css");
  for (const input of ["../../data.json", "https://example.org/data.json", "file:///private", "//remote/file"]) assert.equal(resolvePreviewPath("src/App.tsx", input, files), null);
});

test("preview validation rejects missing entries, duplicate paths, unsupported files and oversized input", () => {
  const source = project([{ path: "App.tsx", content: "export default ()=>null" }]);
  assert.equal(validatePreviewProject(source).entry, "App.tsx");
  for (const files of [[{ path: "../App.tsx", content: "" }], [{ path: "server.py", content: "" }], [{ path: "App.tsx", content: "x".repeat(100001) }], [source.files[0], source.files[0]]]) assert.throws(() => validatePreviewProject({ ...source, files }));
  assert.throws(() => validatePreviewProject({ ...source, entry: "missing.html" }));
  assert.throws(() => validatePreviewProject(project(Array.from({ length: 13 }, (_, i) => ({ path: `file${i}.js`, content: "" })))));
});

test("real TypeScript compilation links local TSX components, JSON and CSS into the isolated runtime", () => {
  const result = compilePreviewProject(project([
    { path: "src/App.tsx", content: 'import React from "react"; import { label } from "./label"; import data from "../data.json"; import "../styles.css"; export default function App(){ const value: string=label+data.suffix; return <button>{value}</button>; }' },
    { path: "src/label.ts", content: 'export const label: string = "Hello";' }, { path: "data.json", content: '{"suffix":" AELVOR"}' }, { path: "styles.css", content: "button{color:green}" }
  ]));
  assert.deepEqual(result.issues, []); assert.match(result.modules["src/App.tsx"], /createElement/);
  const run = execute(result);
  assert.equal(run.context.mounted.type, "button"); assert.equal(run.context.mounted.children[0], "Hello AELVOR");
  assert.deepEqual(run.styles, ["button{color:green}"]); assert.equal(run.messages.at(-1).type, "ready");
});

test("syntax, missing modules and server/CDN dependencies fail with actionable diagnostics", () => {
  for (const content of ['export default function App( { return <div/> }', 'import thing from "fs"; export default ()=>null', 'import x from "https://cdn.example.org/react.js"; export default ()=>null', 'import x from "./missing"; export default ()=>null']) {
    const result = compilePreviewProject(project([{ path: "App.tsx", content }]));
    assert.ok(result.issues.length > 0); assert.throws(() => buildPreviewDocument(result, fakeRuntime, "token"));
  }
  assert.ok(compilePreviewProject(project([{ path: "main.js", content: "console.log('hello')" }, { path: "data.json", content: "invalid" }])).issues.some(issue => issue.file === "data.json"));
});

test("HTML preview retains classic script globals for inline handlers and loads local styles", () => {
  const script = { getAttribute: () => null, textContent: 'function greet(){return "Hello"}; console.log(greet());', remove() {} };
  const parsed = { title: "Sample", body: { innerHTML: '<button onclick="greet()">Hello</button>', attributes: [] }, documentElement: { attributes: [] }, querySelectorAll(selector) { if (selector === "script") return [script]; if (selector === 'link[rel="stylesheet"]') return [{ getAttribute: () => "styles.css" }]; return []; } };
  const result = compilePreviewProject(project([{ path: "index.html", content: "<h1>fixture</h1>" }, { path: "styles.css", content: "button{color:green}" }]));
  const run = execute(result, parsed);
  assert.equal(run.context.greet(), "Hello"); assert.equal(run.document.title, "Sample");
  assert.equal(run.styles[0], "button{color:green}"); assert.ok(run.messages.some(item => item.type === "log" && item.text === "Hello"));
  assert.equal(run.messages.at(-1).type, "ready");
});

test("runtime failures are reported as text and cannot produce a false ready status", () => {
  const result = compilePreviewProject(project([{ path: "main.js", content: 'throw Error("Preview failed on purpose")' }]));
  const run = execute(result);
  assert.equal(run.messages.at(-1).type, "error"); assert.match(run.messages.at(-1).text, /failed on purpose/);
  assert.ok(!run.messages.some(item => item.type === "ready"));
});

test("preview documents quote HTML delimiters and enforce restricted resources independently of user markup", () => {
  const malicious = '</script><script>globalThis.escaped=true</script><meta http-equiv="refresh" content="0;url=https://example.org">';
  const result = compilePreviewProject(project([{ path: "index.html", content: malicious }]));
  const html = buildPreviewDocument(result, fakeRuntime, "token");
  assert.equal((html.match(/<script>/g) || []).length, 1); assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(html.includes('content="' + previewCsp + '"'));
  assert.match(previewCsp, /connect-src 'none'/); assert.match(previewCsp, /frame-src 'none'/); assert.match(previewCsp, /base-uri 'none'/);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script>"));
});

test("preview messages require the current token, a known event type and bounded text", () => {
  const data = { channel: "aelvor-preview", token: "one", type: "log", level: "error", text: "x".repeat(5000) };
  assert.equal(previewEvent(data, "two"), null); assert.equal(previewEvent({ ...data, type: "execute" }, "one"), null);
  assert.equal(previewEvent(data, "one").text.length, 1200);
  assert.equal(previewEvent({ ...data, level: "<script>" }, "one").level, "log");
});

test("aborting compilation terminates its worker and ignores a late success", async () => {
  let instance;
  class FakeWorker { constructor() { instance = this; } postMessage() {} terminate() { this.terminated = true; } }
  const controller = new AbortController(); const pending = compilePreview(project([{ path: "App.tsx", content: "export default ()=>null" }]), controller.signal, () => new FakeWorker()); controller.abort(); instance.onmessage({ data: { ok: true, result: {} } }); await assert.rejects(pending, { name: "AbortError" }); assert.equal(instance.terminated, true);
});

test("draft signatures change only for entry or source edits and do not mutate generated artifacts", () => {
  const artifacts = extractArtifacts([{ id: "message", role: "assistant", content: '```html\n<h1>Original</h1>\n```' }]);
  const source = artifactProject(artifacts[0], artifacts), signature = previewSignature(source);
  const changed = { ...source, files: source.files.map(file => ({ ...file, content: "<h1>Edited</h1>" })) };
  assert.notEqual(previewSignature(changed), signature); assert.match(artifacts[0].content, /Original/);
});

