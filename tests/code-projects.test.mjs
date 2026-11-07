// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { codeProjectTargets, codeProjectLimits, codeProjectsKey, codeProjectsBackup, parseCodeProjects, readCodeProjects, writeCodeProjects, validateCodeFiles, validateCodeProjects, mergeCodeFiles, mergeCodeProjects, codeFileTree, codeProjectFromArtifacts, codeProjectPreviewArtifacts, codeProjectAiRequest, appendCodeProjectRequest, projectSlug } from "../lib/code-projects.ts";
import { codeExtension, codeLanguage, codeFilePath, languageForPath, explicitCodeFilename } from "../lib/code-files.ts";
import { codeFences } from "../lib/code-fences.ts";
import { codeProjectZip, projectCrc32 } from "../lib/project-zip.ts";
import { createProjectScaffold, codeProjectGuide, requestedProjectTarget, scaffoldMarkdown } from "../lib/project-scaffolds.ts";
import { extractArtifacts } from "../lib/local-tools.ts";
import { attributeMarkdown } from "../lib/copyright.ts";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";
import { runLocalAgent } from "../lib/local-agent.ts";
import { generationPolicy } from "../lib/generation-policy.ts";
import { artifactProject } from "../lib/artifact-project.ts";
import { compilePreviewProject } from "../lib/preview-compiler-core.ts";

const fixedTime = 1793520000000;
const starter = (target = "react", name = "Bright Ideas", id = target) => createProjectScaffold(target, name, "com.alen.bright", id, "en", fixedTime);
const withDirectory = action => { const folder = mkdtempSync(join(tmpdir(), "aelvor-project-test-")); try { return action(folder); } finally { rmSync(folder, { recursive: true, force: true }); } };
const writeProject = (folder, project) => { for (const file of project.files) { const path = join(folder, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content); } };
const run = (cmd, args, cwd) => { const result = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 60_000 }); assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}\n${result.stderr}`); return result.stdout; };

test("all source starters are coherent, bounded, attributed and round-trip through complete file fences", () => {
  for (const target of codeProjectTargets) for (const locale of ["en", "de"]) {
    const project = createProjectScaffold(target, 'Alen’s "Bright" & $Ideas <3', "com.alen.bright", target, locale, fixedTime);
    assert.equal(validateCodeProjects([project])[0].target, target);
    assert.ok(project.files.length >= 3); assert.ok(project.files.some(file => file.path === "README.md"));
    assert.ok(codeProjectGuide(project, locale).requirements);
    for (const file of project.files) {
      assert.equal(codeFilePath(file.path), file.path);
      if (file.path.endsWith(".json")) assert.doesNotThrow(() => JSON.parse(file.content));
      else if (languageForPath(file.path) !== "text" || file.path === ".gitignore") assert.ok(file.content.includes(COPYRIGHT_NOTICE), file.path);
    }
    const markdown = scaffoldMarkdown(project, locale);
    assert.equal(attributeMarkdown(markdown), markdown);
    const files = extractArtifacts([{ id: "source", role: "assistant", content: markdown }]).filter(file => file.kind === "code");
    assert.equal(files.length, project.files.length, target);
    assert.deepEqual(files.map(file => [file.filename, file.content.trimEnd()]), project.files.map(file => [file.path, file.content.trimEnd()]));
    const imported = codeProjectFromArtifacts(files[0], files, "new", fixedTime);
    assert.equal(imported.files.length, project.files.length);
    assert.equal(imported.target, target === "node" ? "node" : target);
  }
});

test("source path validation prevents traversal, binaries, platform collisions and folder/file conflicts", () => {
  for (const path of ["../main.py", "/etc/passwd", "C:/main.py", "src//a.js", "src/./a.js", "src/../a.js", ".git/config", "SRC/.GIT/x", "CON", "aux.txt", "a/NUL.py", "COM1.ts", "folder./main.ts", "app.apk", "image.PNG", "a\u0000b", "x".repeat(241)]) assert.throws(() => codeFilePath(path), /code_project_path/, path);
  assert.equal(codeFilePath(".\\src\\App.tsx"), "src/App.tsx");
  for (const files of [[{ path: "src/App.ts", content: "" }, { path: "SRC/app.TS", content: "" }], [{ path: "src", content: "" }, { path: "src/main.ts", content: "" }]]) assert.throws(() => validateCodeFiles(files));
  assert.throws(() => validateCodeFiles([{ path: "main.py", content: "a\u0000b" }]));
  assert.throws(() => validateCodeFiles([{ path: "main.py", content: "a".repeat(codeProjectLimits.fileCharacters + 1) }]));
  assert.throws(() => validateCodeProjects([{ ...starter(), slug: "con" }]), /code_project_path/);
  assert.doesNotThrow(() => validateCodeFiles([{ path: ".env.example", content: "" }, { path: "Dockerfile", content: "FROM node:22" }, { path: "src/main.unknown", content: "custom source" }]));
});

test("language inference and explicit filenames cover native, backend and general source languages", () => {
  for (const [path, language] of [["app/build.gradle.kts", "kotlin"], ["Sources/View.swift", "swift"], ["lib/main.dart", "dart"], ["main.cs", "csharp"], ["main.go", "go"], ["src/lib.rs", "rust"], ["main.cpp", "cpp"], ["headers/x.hpp", "cpp"], ["Dockerfile", "dockerfile"], ["Makefile", "makefile"], ["Info.plist", "xml"], ["pubspec.yaml", "yaml"], ["src/index.mjs", "javascript"]]) { assert.equal(languageForPath(path), language); assert.equal(explicitCodeFilename(path, language), path); }
  assert.equal(codeLanguage("c# filename=main.cs"), "csharp");
  assert.equal(codeLanguage("src/App.tsx"), "tsx");
  assert.equal(explicitCodeFilename("evil.exe", "typescript"), null);
  assert.equal(codeExtension("constructor"), "txt"); assert.equal(codeExtension("__proto__"), "txt");
});

test("nested README fences and adjacent code blocks retain content, offsets and streaming completeness", () => {
  const source = 'Before\n````markdown filename=README.md\n# Usage\n```sh\nnpm run build\n```\nAfter\n````\n```swift filename=Sources/Main.swift\nimport SwiftUI\n```\nTail';
  const fences = codeFences(source); assert.equal(fences.length, 2); assert.equal(fences[0].closed, true); assert.match(fences[0].code, /```sh\nnpm run build\n```\nAfter/);
  assert.equal(source.slice(fences[0].codeStart, fences[0].codeEnd), fences[0].code);
  assert.equal(attributeMarkdown(attributeMarkdown(source)), attributeMarkdown(source));
  assert.equal(extractArtifacts([{ id: "source", role: "assistant", content: source }]).length, 2);
  const unfinished = codeFences('````markdown\n# Usage\n```sh\nnpm install\n```'); assert.equal(unfinished.length, 1); assert.equal(unfinished[0].closed, false);
  assert.equal(extractArtifacts([{ id: "source", role: "assistant", content: '````markdown\n# Usage\n```sh\nx\n```' }]).length, 0);
});

test("backups whitelist data, preserve identity and report unavailable or corrupt storage without writing", () => {
  const project = starter("python"), backup = codeProjectsBackup([{ ...project, unexpected: "discard", files: project.files.map(file => ({ ...file, executable: true })) }]);
  const parsed = parseCodeProjects(JSON.stringify(backup)); assert.deepEqual(parsed, [project]);
  let stored = null, writes = 0;
  assert.deepEqual(readCodeProjects({ getItem: () => null }), { projects: [], error: false });
  assert.equal(writeCodeProjects(parsed, { setItem(key, text) { assert.equal(key, codeProjectsKey); stored = text; writes++; } }), true);
  assert.deepEqual(readCodeProjects({ getItem: () => stored }).projects, parsed);
  for (const broken of ["{", '{"format":"other","version":1,"projects":[]}', JSON.stringify({ ...backup, version: 2 }), JSON.stringify({ ...backup, projects: [{ ...project, files: [{ path: "../../x", content: "x" }] }] })]) assert.equal(readCodeProjects({ getItem: () => broken }).error, true);
  assert.equal(writes, 1);
  assert.equal(writeCodeProjects(parsed, { setItem() { throw Error("Quota exceeded"); } }), false);
  assert.equal(readCodeProjects({ getItem() { throw Error("Storage denied"); } }).error, true);
});

test("file application replaces matching paths atomically, preserves unrelated files and separates assistant replies", () => {
  const original = starter("python"), snapshot = JSON.stringify(original);
  const updated = mergeCodeFiles(original, [{ path: "APP/main.py", content: "print('Updated')" }, { path: "app/extra.py", content: "print('New')" }], fixedTime + 1);
  assert.equal(updated.files.find(file => file.path === "app/main.py").content, "print('Updated')");
  assert.equal(updated.files.find(file => file.path === "README.md").content, original.files.find(file => file.path === "README.md").content);
  assert.equal(JSON.stringify(original), snapshot);
  assert.throws(() => mergeCodeFiles(original, [{ path: "app", content: "conflict" }])); assert.equal(JSON.stringify(original), snapshot);
  const artifacts = extractArtifacts([{ id: "a", role: "assistant", content: '```python filename=app/main.py\nprint(1)\n```' }, { id: "b", role: "assistant", content: '```python filename=other.py\nprint(2)\n```' }]);
  assert.deepEqual(codeProjectFromArtifacts(artifacts[0], artifacts, "safe").files.map(file => file.path), ["app/main.py"]);
  const diff = { ...artifacts[0], language: "diff", content: "--- old\n+++ new" };
  assert.throws(() => codeProjectFromArtifacts(diff, [diff], "safe"), /code_project_patch/);
});

test("backup merging skips identical copies and resolves ID collisions without changing existing projects", () => {
  const first = starter(), collision = { ...starter("python"), id: first.id }, existing = [first];
  const merged = mergeCodeProjects(existing, [first, { ...collision, id: "other" }], () => "new-id");
  assert.equal(merged.added, 1); assert.equal(merged.skipped, 1);
  const resolved = mergeCodeProjects(existing, [collision], () => "new-id"); assert.equal(resolved.projects[1].id, "new-id"); assert.deepEqual(existing, [first]);
  assert.throws(() => mergeCodeProjects(existing, [collision], () => first.id), /code_project_id/);
  const full = Array.from({ length: 12 }, (_, index) => ({ ...first, id: `p${index}`, name: `P${index}` }));
  assert.throws(() => mergeCodeProjects(full, [starter("node")], () => "new-id"), /code_project_limit/);
});

test("AI context fits the serialized budget, preserves the chat draft and labels partial files honestly", () => {
  const project = { ...starter("general"), files: [{ path: "src/main.cpp", content: "// keep upstream notice\nint main() { return 0; }\n" }] };
  const full = codeProjectAiRequest(project, "Add input validation", "src/main.cpp", "de", 2400);
  assert.ok(full.length <= 2400); assert.match(full, /Reply in German/); assert.match(full, /complete/); assert.match(full, /int main/); assert.match(full, /filename=relative\/path.ext/);
  const existing = "Existing unsent draft\nwith important details  ";
  const combined = appendCodeProjectRequest(existing, project, "Refine this file", "src/main.cpp", "en", 2400);
  assert.ok(combined.startsWith(existing + "\n\n")); assert.ok(combined.length <= 2400);
  assert.throws(() => appendCodeProjectRequest("x".repeat(2300), project, "Add input validation", "src/main.cpp", "en", 2400), /code_project_context/);
  const big = { ...project, files: [{ path: "src/main.cpp", content: "// routine\n".repeat(500) + "// unique validation boundary\n" }] };
  const partial = codeProjectAiRequest(big, "Fix the unique validation boundary", "src/main.cpp", "en", 2400);
  assert.ok(partial.length <= 2400); assert.match(partial, /partial/); assert.match(partial, /do not invent omitted code/); assert.match(partial, /startLine/); assert.match(partial, /unique validation/);
  assert.throws(() => codeProjectAiRequest(project, "", "src/main.cpp", "en", 2400), /code_project_instruction/);
});

test("project trees group nested source files and sort folders before files", () => {
  const files = [{ path: "README.md", content: "" }, { path: "src/z.ts", content: "" }, { path: "src/a.ts", content: "" }], tree = codeFileTree(files);
  assert.deepEqual(tree.map(item => item.name), ["src", "README.md"]); assert.deepEqual(tree[0].children.map(item => item.name), ["a.ts", "z.ts"]); assert.equal(tree[0].children[0].file, files[2]);
});

test("ZIPs decode with Python zipfile, preserve nested UTF-8 contents and verify CRCs", () => withDirectory(folder => {
  assert.equal(projectCrc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (const target of codeProjectTargets) {
    const project = starter(target), path = join(folder, `${target}.zip`); writeFileSync(path, codeProjectZip(project, new Date(fixedTime)));
    const expected = JSON.stringify(Object.fromEntries(project.files.map(file => [`${project.slug}/${file.path}`, file.content]))); writeFileSync(join(folder, "expected.json"), expected);
    run("python", ["-c", 'import json,sys,zipfile\nfrom pathlib import PurePosixPath\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n expected=json.load(open(sys.argv[2]))\n assert set(z.namelist())==set(expected)\n for name,text in expected.items():\n  assert not PurePosixPath(name).is_absolute() and ".." not in PurePosixPath(name).parts\n  assert z.read(name).decode("utf-8")==text\n  assert not z.getinfo(name).is_dir()', path, join(folder, "expected.json")], folder);
  }
}));

test("Python starter really runs its CLI and generated tests without dependencies", () => withDirectory(folder => {
  writeProject(folder, starter("python"));
  assert.equal(run("python", ["-m", "app.main", "--name", " Alen "], folder).trim(), "Hello, Alen!");
  run("python", ["-m", "unittest", "discover", "-s", "tests"], folder);
}));

test("React and Node starters pass the actual TypeScript checker with the installed pinned dependencies", () => {
  for (const target of ["react", "node"]) withDirectory(folder => {
    const project = starter(target); writeProject(folder, project); symlinkSync(resolve("node_modules"), join(folder, "node_modules"), "dir");
    run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], folder);
    if (target === "react") run(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build"], folder);
    if (target === "node") run(process.execPath, ["--test", "test/greeting.test.mjs"], folder);
  });
});

test("web preview uses only runtime files and compiles the starter's complete module graph", () => {
  for (const target of ["web", "react"]) {
    const project = starter(target), artifacts = codeProjectPreviewArtifacts(project);
    assert.ok(artifacts.length); assert.ok(artifacts.every(item => !/package.json|vite.config|tsconfig|README|gitignore/.test(item.filename)));
    const output = compilePreviewProject(artifactProject(artifacts[0], artifacts));
    assert.deepEqual(output.issues, [], target); assert.ok(output.project.files.length >= 3);
  }
  for (const target of ["python", "node", "android", "ios", "flutter", "general"]) assert.deepEqual(codeProjectPreviewArtifacts(starter(target)), []);
});

test("native starter manifests and guides agree on source paths and external build requirements", () => withDirectory(folder => {
  const android = starter("android"), ios = starter("ios"), flutter = starter("flutter"), file = (p, path) => p.files.find(f => f.path === path)?.content;
  assert.match(file(android, "app/build.gradle.kts"), /namespace = "com.alen.bright"/);
  assert.match(file(android, "app/src/main/java/com/alen/bright/MainActivity.kt"), /package com.alen.bright/);
  assert.match(file(android, "build.gradle.kts"), /8\.13\.2/); assert.match(file(android, "build.gradle.kts"), /2\.3\.10/);
  assert.match(file(android, "app/build.gradle.kts"), /2025\.12\.00/);
  const tricky = starter("android", 'Alen’s "A&B" $App <3 @home 100%'); writeProject(folder, tricky);
  run("python", ["-c", 'import sys,xml.etree.ElementTree as E\nr=E.parse(sys.argv[1]).getroot()\nassert r.find("string").attrib["formatted"]=="false"\nassert "A&B" in r.find("string").text', join(folder, "app/src/main/res/values/strings.xml")], folder);
  assert.match(file(ios, "project.yml"), /GENERATE_INFOPLIST_FILE: YES/); assert.match(file(ios, "project.yml"), /sources: \[Sources\]/); assert.match(file(ios, "Sources/GeneratedApp.swift"), /@main/);
  assert.match(codeProjectGuide(ios, "en").commands.join("\n"), /xcodegen generate[\s\S]*xcodebuild/); assert.match(codeProjectGuide(ios, "en").note, /does not build or sign an IPA/);
  assert.match(file(flutter, "pubspec.yaml"), /name: bright_ideas/); assert.match(file(flutter, "test/widget_test.dart"), /package:bright_ideas\/main.dart/); assert.match(codeProjectGuide(flutter, "en").commands[0], /flutter create.*--platforms android,ios/);
  assert.ok(![...android.files, ...ios.files, ...flutter.files].some(item => /\.(?:apk|ipa|jar)$/.test(item.path)));
  for (const target of ["android", "ios"]) assert.throws(() => createProjectScaffold(target, "App", "INVALID/package", "id"), /code_project_package/);
}));

test("English and German project requests use local templates without a model or network", async () => {
  for (const [text, locale, target] of [["Create a React app named Bright Ideas", "en", "react"], ["Erstelle eine Android App namens Bright Ideas", "de", "android"], ["Build an iOS app", "en", "ios"], ["Create a Python program", "en", "python"], ["Create an Android and iOS app", "en", "flutter"], ["Build a Rust software project", "en", "general"]]) {
    assert.equal(requestedProjectTarget(text), target);
    const response = await runLocalAgent({ text, locale, mode: "build" }); assert.equal(response.kind, "project"); assert.match(response.text, /README.md/); assert.ok(response.steps.includes("organize-source-files"));
    assert.equal(generationPolicy({ text }).task, "code");
  }
  for (const name of ["class", "switch", "flutter", "test", "CON", "LPT1"]) assert.match(projectSlug(name), /^app-/);
  assert.throws(() => createProjectScaffold("android", "App", "com.example.class", "id"), /code_project_package/);
  for (const text of ["What is an Android app?", "Write a poem about software", "Schreibe einen Brief über eine App", "Translate: Create an Android app"]) assert.equal(requestedProjectTarget(text), null);
  assert.equal(generationPolicy({ text: "Translate: Create an Android app" }).task, "translation");
  assert.equal(generationPolicy({ text: "Write a poem about software" }).task, "writing");
  assert.equal(generationPolicy({ text: "Write an Android app for poems" }).task, "code");
  assert.equal((await runLocalAgent({ text: "Create a local model", locale: "en", mode: "auto" })).kind, "model");
});
