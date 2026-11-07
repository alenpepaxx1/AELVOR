// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { addProjectVersion } from "../lib/project-versions.ts";
const History = await loadComponent(new URL("../app/project-version-history.tsx", import.meta.url));
const Diff = await loadComponent(new URL("../app/project-diff-view.tsx", import.meta.url));
const Search = await loadComponent(new URL("../app/project-code-search.tsx", import.meta.url));
const Projects = await loadComponent(new URL("../app/code-projects.tsx", import.meta.url));
const noop = () => {};
const project = { id: "one", name: "Useful tools", slug: "useful-tools", target: "python", createdAt: 1, updatedAt: 2, files: [{ path: "main.py", content: "old\n" }] };
const versions = addProjectVersion([], project, "Before changes", "v1", 3).versions;
const store = { versions, persisted: true, loadError: false, ready: true, capture: noop, remove: noop, merge: noop, retry: noop };
const renderHistory = (locale, extra = {}) => renderToStaticMarkup(createElement(History, { projects: [project], project, locale, store, onRestore: () => true, onClose: noop, ...extra }));
for (const locale of ["en", "de"]) {
  const de = locale === "de";
  test(`${locale}: saved versions expose named checkpoints, separate backups, full source comparison and limits`, () => {
    const current = { ...project, files: [{ path: "main.py", content: "current\n" }, { path: "new.py", content: "new\n" }] };
    const html = renderHistory(locale, { projects: [current], project: current });
    for (const text of de ? ["Versionsverlauf", "Stand speichern", "Verlauf exportieren", "Verlauf importieren", "Vor dem Ersetzen", "Dateientfernungen", "900.000"] : ["Version history", "Save version", "Export history", "Import history", "before replacing", "file removals", "900,000"]) assert.ok(html.includes(text), text);
    assert.match(html, /main.py/); assert.match(html, /new.py/); assert.match(html, de ? /Entfernt/ : /Removed/);
    assert.doesNotMatch(html, /<iframe|<script/);
  });
  test(`${locale}: identical versions disable replacing the existing project but allow a copy`, () => {
    const html = renderHistory(locale);
    assert.match(html, de ? /disabled=""[^>]*>.*?Dieses Projekt wiederherstellen/s : /disabled=""[^>]*>.*?Restore this project/s);
    assert.match(html, de ? /Als Kopie wiederherstellen/ : /Restore as copy/);
    assert.match(html, de ? /Keine Quelländerungen/ : /No source changes/);
  });
  test(`${locale}: deleted-project recovery remains available without an active project`, () => {
    const html = renderHistory(locale, { projects: [], project: undefined });
    assert.match(html, de ? /ursprüngliche Projekt ist nicht vorhanden/ : /original project is not present/);
    assert.match(html, de ? /Als Kopie wiederherstellen/ : /Restore as copy/);
    assert.doesNotMatch(html, de ? /Dieses Projekt wiederherstellen/ : /Restore this project/);
  });
  test(`${locale}: history failures and unreadable state never claim saved persistence`, () => {
    const failed = renderHistory(locale, { store: { ...store, persisted: false } });
    assert.match(failed, de ? /Nicht gespeichert/ : /Not saved/); assert.match(failed, de ? /Erneut speichern/ : /Retry saving/);
    assert.match(failed, de ? /ältere Stände können nach dem Neuladen zurückkehren/ : /older versions may return after reload/);
    const unreadable = renderHistory(locale, { store: { ...store, versions: [], persisted: false, loadError: true } });
    assert.match(unreadable, de ? /Vorhandene Browserdaten bleiben/ : /Existing browser data is unchanged/);
    assert.doesNotMatch(unreadable, de ? /Erneut speichern/ : /Retry saving/);
  });
  test(`${locale}: diff source is escaped and line ending changes are visible without execution`, () => {
    const html = renderToStaticMarkup(createElement(Diff, { before: "same\n", after: 'same\n<script>alert("x")</script>', path: "src/app.ts", locale }));
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|<iframe/);
    assert.match(html, de ? /kein abschließender Zeilenumbruch/ : /no final newline/);
    assert.match(html, de ? /Ganze Datei/ : /Full file/); assert.match(html, /class="cp-diff-row add"/);
  });
  test(`${locale}: project source search supplies localized filters and is hidden outside its view`, () => {
    const visible = renderToStaticMarkup(createElement(Search, { project, locale, onOpen: noop }));
    assert.match(visible, de ? /Groß-\/Kleinschreibung/ : /Match case/); assert.match(visible, de ? /Ganze Wörter/ : /Whole words/);
    assert.match(visible, /type="search" maxLength="160"/); assert.doesNotMatch(visible, /hidden=""/);
    const hidden = renderToStaticMarkup(createElement(Search, { project, locale, onOpen: noop, active: false })); assert.match(hidden, /class="cp-code-search" hidden=""/);
  });
  test(`${locale}: AI review selects files individually and displays destination diff before apply`, () => {
    const incoming = { ...project, id: "incoming", files: [{ path: "main.py", content: "new\n" }, { path: "new.py", content: "new file\n" }] };
    const html = renderToStaticMarkup(createElement(Projects, { projects: [project], selectedId: "one", locale, saveStatus: "saved", loadError: false, incoming, history: store, onChange: () => true, onSelect: noop, onAiRequest: () => true, onRetrySave: noop, onDismissImport: noop }));
    assert.match(html, de ? /main.py übernehmen/ : /Include main.py/); assert.match(html, de ? /new.py übernehmen/ : /Include new.py/);
    assert.match(html, de ? /Alle auswählen/ : /Select all/); assert.match(html, de ? /Dateien ausgewählt/ : /files selected/);
    assert.match(html, /class="cp-diff-row remove"/); assert.match(html, /class="cp-diff-row add"/);
    assert.match(html, de ? /Versionsverlauf/ : /Version history/);
  });
}
