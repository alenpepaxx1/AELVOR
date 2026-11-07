// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { createProjectScaffold } from "../lib/project-scaffolds.ts";
import { codeProjectPreviewArtifacts } from "../lib/code-projects.ts";
const CodeProjects = await loadComponent(new URL("../app/code-projects.tsx", import.meta.url));
const Markdown = await loadComponent(new URL("../app/markdown.tsx", import.meta.url));
const Workbench = await loadComponent(new URL("../app/artifact-workbench.tsx", import.meta.url));
const noop = () => {};
const base = locale => ({ projects: [], selectedId: null, locale, saveStatus: "saved", loadError: false, incoming: null, onDismissImport: noop, onChange: () => true, onSelect: noop, onRetrySave: noop, onAiRequest: () => true });
for (const locale of ["en", "de"]) {
  const de = locale === "de";
  test(`${locale}: project creation presents all eight starter choices and explains source generation`, () => {
    const html = renderToStaticMarkup(createElement(CodeProjects, base(locale)));
    for (const name of ["Web", "React", "Python", "Node.js", "Android", "iOS", "Flutter"]) assert.ok(html.includes(name), name);
    assert.match(html, de ? /Lokale Quellvorlagen funktionieren ohne Modell/ : /Local source templates work without a model/);
    assert.match(html, de ? /Quellprojekt erstellen/ : /Create source project/);
    assert.match(html, /Copyright © 2026 Alen Pepa/);
    assert.doesNotMatch(html, /<iframe|<script/);
  });
  test(`${locale}: saved projects render a folder tree, editable source, ZIP export and a scoped AI request`, () => {
    const project = createProjectScaffold("python", "Useful tools", "com.alen.app", "one", locale, 1);
    const html = renderToStaticMarkup(createElement(CodeProjects, { ...base(locale), projects: [project], selectedId: project.id }));
    assert.match(html, /app/); assert.match(html, /main.py/); assert.match(html, /README.md/);
    assert.match(html, de ? /Projektquellcode bearbeiten/ : /Edit project source/);
    assert.match(html, de ? /ZIP herunterladen/ : /Download ZIP/);
    assert.match(html, de ? /Build-Anleitung/ : /Build guide/);
    assert.match(html, de ? /AI-Anfrage zum Chat hinzufügen/ : /Add AI request to chat/);
    assert.doesNotMatch(html, de ? />Webvorschau</ : />Web preview</);
    assert.doesNotMatch(html, /<iframe/);
  });
  test(`${locale}: AI file import names replacements and requires an explicit apply action`, () => {
    const project = createProjectScaffold("python", "Useful tools", "com.alen.app", "one", locale, 1);
    const incoming = { ...project, id: "incoming", files: [{ path: "app/main.py", content: '<script>alert("escaped")</script>' }, { path: "app/new.py", content: "print(42)" }] };
    const html = renderToStaticMarkup(createElement(CodeProjects, { ...base(locale), projects: [project], selectedId: project.id, incoming }));
    assert.match(html, de ? /Dateien aus AI prüfen/ : /Review files from AI/);
    assert.match(html, de ? />Ersetzen</ : />Replace</);
    assert.match(html, de ? />Neu</ : />New</);
    assert.match(html, de ? /Dateien übernehmen/ : /Apply files/);
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  });
  test(`${locale}: saving failures and unreadable storage never appear as saved`, () => {
    const failed = renderToStaticMarkup(createElement(CodeProjects, { ...base(locale), saveStatus: "failed" }));
    assert.match(failed, de ? /Erneut speichern/ : /Retry saving/);
    assert.match(failed, de ? /frühere Projekte können/ : /older projects may/);
    assert.doesNotMatch(failed, de ? />Auf diesem Gerät gespeichert</ : />Saved on this device</);
    const unreadable = renderToStaticMarkup(createElement(CodeProjects, { ...base(locale), saveStatus: "failed", loadError: true }));
    assert.match(unreadable, de ? /Vorhandene Browserdaten bleiben unverändert/ : /existing browser data stays unchanged/);
  });
  test(`${locale}: all complete source languages can become projects and pending outputs stay disabled`, () => {
    const props = { locale, onNotice: noop, onOpen: noop };
    for (const language of ["kotlin", "swift", "dart", "python", "csharp", "rust", "go"]) {
      const html = renderToStaticMarkup(createElement(Markdown, { ...props, text: `\`\`\`${language}\nsource\n\`\`\`` }));
      assert.match(html, de ? /Dateien als Code-Projekt organisieren/ : /Organize files as a code project/);
      assert.doesNotMatch(html, /class="code-project-button" disabled/);
    }
    for (const extra of [{ text: '```swift\nunfinished' }, { text: '```swift\nimport SwiftUI\n```', pending: true }]) {
      const html = renderToStaticMarkup(createElement(Markdown, { ...props, ...extra })); assert.match(html, /class="code-project-button" disabled=""/);
    }
  });
  test(`${locale}: embedded web preview keeps the project source authoritative and requires Run`, () => {
    const project = createProjectScaffold("react", "UI", "com.alen.app", "one", locale, 1), artifacts = codeProjectPreviewArtifacts(project);
    const html = renderToStaticMarkup(createElement(Workbench, { artifact: artifacts[0], artifacts, locale, active: true, previewOnly: true, onNotice: noop }));
    assert.match(html, /preview-only/); assert.match(html, /class="workbench-code-view" hidden=""/);
    assert.match(html, de ? /Bearbeite Dateien unter Quellcode/ : /Return to Source to edit files/);
    assert.match(html, de ? /Vorschau starten/ : /Run preview/); assert.doesNotMatch(html, /<iframe/);
  });
}
