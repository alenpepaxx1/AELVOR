// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { createProjectScaffold } from "../lib/project-scaffolds.ts";
import { mergeCodeFiles, codeProjectPreviewArtifacts, selectedCodeProjectFile } from "../lib/code-projects.ts";
import { artifactProject } from "../lib/artifact-project.ts";
import { compilePreviewProject } from "../lib/preview-compiler-core.ts";
import { requestedProjectTarget } from "../lib/project-intent.ts";
import { runLocalAgent } from "../lib/local-agent.ts";
const CodeProjects = await loadComponent(new URL("../app/code-projects.tsx", import.meta.url));
const scaffold = target => createProjectScaffold(target, "Source project", "com.example.app", target, "en", 1);

test("case-insensitive AI replacements keep the original canonical filename and its imports working", () => {
  const source = scaffold("react"), original = source.files.find(file => file.path === "src/App.tsx");
  const updated = mergeCodeFiles(source, [{ path: "SRC/app.tsx", content: original.content.replace("Your project.", "Updated project.") }]);
  assert.equal(updated.files.find(file => file.path.toLowerCase() === "src/app.tsx").path, "src/App.tsx");
  const artifacts = codeProjectPreviewArtifacts(updated);
  assert.deepEqual(compilePreviewProject(artifactProject(artifacts[0], artifacts)).issues, []);
  assert.equal(source.files.find(file => file.path === "src/App.tsx"), original);
});

test("preview keeps every accepted explicit project path, including paths beyond 120 characters", () => {
  const path = "src/" + "nested/".repeat(20) + "App.tsx";
  const input = { ...scaffold("react"), files: [{ path: "src/main.tsx", content: `export { default } from ${JSON.stringify("./" + path.slice(4))};` }, { path, content: "export default function App(){return <main>Long path</main>}" }] };
  const artifacts = codeProjectPreviewArtifacts(input), preview = artifactProject(artifacts[0], artifacts);
  assert.equal(preview.files[1].path, path);
  assert.deepEqual(compilePreviewProject(preview).issues, []);
});

test("invalid explicit preview paths stay visible to validation instead of silently becoming another file", () => {
  const input = { id: "bad", messageId: "m", kind: "code", title: "Invalid source", filename: "../../App.tsx", filenameExplicit: true, language: "tsx", content: "export default ()=>null" };
  assert.throws(() => compilePreviewProject(artifactProject(input, [input])), /Invalid file path/);
});

test("CommonJS files remain available to web-project imports", () => {
  const input = { ...scaffold("react"), files: [{ path: "src/App.tsx", content: 'import value from "./value.cjs"; export default ()=> <div>{value}</div>' }, { path: "src/value.cjs", content: "module.exports = 42;" }] };
  const artifacts = codeProjectPreviewArtifacts(input);
  assert.deepEqual(artifacts.map(item => item.filename), ["src/App.tsx", "src/value.cjs"]);
  assert.deepEqual(compilePreviewProject(artifactProject(artifacts[0], artifacts)).issues, []);
});

test("local project routing reads the requested platform independently of the project name", async () => {
  for (const [text, target] of [["Create a Python application called React Monitor", "python"], ["Build an iOS app named Android Tracker", "ios"], ["Create a Rust program named Node Tools", "general"], ["Erstelle eine Android App namens Flutter Journal", "android"], ["Create a NodeJS application called Python Monitor", "node"]]) assert.equal(requestedProjectTarget(text), target, text);
  const result = await runLocalAgent({ text: "Build an iOS app named Android Tracker", locale: "en", mode: "build" });
  assert.match(result.text, /Sources\/ContentView.swift/); assert.doesNotMatch(result.text, /filename=pubspec.yaml/);
});

test("opening a starter selects its application source instead of .gitignore", () => {
  const noop = () => {};
  for (const [target, sourcePath] of [["react", "src/App.tsx"], ["python", "app/main.py"], ["android", "app/src/main/java/com/example/app/MainActivity.kt"], ["ios", "Sources/ContentView.swift"]]) {
    const project = scaffold(target);
    const html = renderToStaticMarkup(createElement(CodeProjects, { projects: [project], selectedId: project.id, locale: "en", saveStatus: "saved", loadError: false, incoming: null, onDismissImport: noop, onChange: () => true, onSelect: noop, onRetrySave: noop, onAiRequest: () => true }));
    assert.match(html, new RegExp('aria-label="Source file path"[^>]*value="' + sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"'), target);
  }
});

test("source selections belong to a project and survive a case-insensitive incoming replacement", () => {
  const project = scaffold("react");
  assert.equal(selectedCodeProjectFile(project, { projectId: project.id, path: "SRC/main.tsx" }).path, "src/main.tsx");
  assert.equal(selectedCodeProjectFile(project, { projectId: "another-project", path: "src/main.tsx" }).path, "src/App.tsx");
  assert.equal(selectedCodeProjectFile(project, { projectId: project.id, path: "deleted.tsx" }).path, "src/App.tsx");
  const updated = mergeCodeFiles(project, [{ path: "SRC/APP.tsx", content: "export default ()=>null;" }]);
  assert.equal(selectedCodeProjectFile(updated, { projectId: project.id, path: "SRC/APP.tsx" }).path, "src/App.tsx");
});

test("every starter initially focuses a useful application entry", () => {
  for (const [target, path] of [["web", "index.html"], ["react", "src/App.tsx"], ["python", "app/main.py"], ["node", "src/server.ts"], ["android", "app/src/main/java/com/example/app/MainActivity.kt"], ["ios", "Sources/ContentView.swift"], ["flutter", "lib/main.dart"], ["general", "src/main.txt"]]) assert.equal(selectedCodeProjectFile(scaffold(target)).path, path);
});

test("unnamed snippets cannot occupy a later explicitly named preview file", () => {
  const base = { kind: "code", title: "Sources", language: "javascript", messageId: "reply", content: "console.log('source');" };
  const snippets = [{ ...base, id: "generic", filename: "aelvor-1.js" }, { ...base, id: "explicit", filename: "script.js", filenameExplicit: true }];
  const project = artifactProject(snippets[1], snippets);
  assert.deepEqual(project.files.map(file => file.path), ["script-2.js", "script.js"]);
  assert.equal(project.entry, "script.js");
  assert.deepEqual(compilePreviewProject(project).issues, []);
});

test("Preview opens the chosen document and standalone script while CSS keeps the app entry", () => {
  const base = { kind: "code", title: "Sources", messageId: "reply", filenameExplicit: true, content: "source" };
  const html = [{ ...base, id: "one", filename: "index.html", language: "html" }, { ...base, id: "two", filename: "other.html", language: "html" }, { ...base, id: "css", filename: "styles.css", language: "css" }];
  assert.equal(artifactProject(html[1], html).entry, "other.html");
  assert.equal(artifactProject(html[2], html).entry, "index.html");
  const scripts = [{ ...base, id: "helper", filename: "helper.js", language: "javascript" }, { ...base, id: "app", filename: "app.js", language: "javascript" }];
  assert.equal(artifactProject(scripts[1], scripts).entry, "app.js");
});
