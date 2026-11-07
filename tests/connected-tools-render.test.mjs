// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { createKnowledgeDocument } from "../lib/knowledge-library.ts";
import { searchKnowledge } from "../lib/knowledge-retrieval.ts";
const Terminal = await loadComponent(new URL("../app/windows-terminal.tsx", import.meta.url));
const Web = await loadComponent(new URL("../app/web-source-import.tsx", import.meta.url));
const Library = await loadComponent(new URL("../app/knowledge-library.tsx", import.meta.url));
const Sources = await loadComponent(new URL("../app/knowledge-sources.tsx", import.meta.url));
const noop = () => {};
for (const locale of ["en", "de"]) {
  const de = locale === "de";
  test(`${locale}: Windows panel offers explicit connection, shell selection, cancellation limits and disabled Run`, () => {
    const html = renderToStaticMarkup(createElement(Terminal, { locale, busy: false, onAiRequest: () => true }));
    for (const text of ["Windows PowerShell", "CMD", "aelvor-windows-bridge.mjs", "Node.js 22", "128 KiB", "Get-Location"]) assert.ok(html.includes(text), text);
    assert.match(html, /type="password"[^>]*maxLength="64"/); assert.match(html, de ? /Befehle nicht automatisch/ : /does not execute commands automatically/);
    assert.match(html, de ? /keine Dateisystem-Sandbox/ : /not a filesystem sandbox/);
    assert.match(html, de ? /disabled=""[^>]*>.*?Unter Windows ausführen/s : /disabled=""[^>]*>.*?Run on Windows/s);
    assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  });
  test(`${locale}: public web sources are reviewed before insertion with truthful host and size limits`, () => {
    let writes = 0;
    const html = renderToStaticMarkup(createElement(Web, { locale, disabled: false, onAdd() { writes++; return { saved: true, added: true }; } }));
    assert.match(html, de ? /Webquelle lesen/ : /Read a web source/); assert.match(html, /learn.microsoft.com/); assert.match(html, /1 MiB/); assert.match(html, /40.000/); assert.match(html, de ? /Gespräch, Dateien und Modell werden nicht hochgeladen/ : /conversation, files and model are not uploaded/);
    assert.equal(writes, 0); assert.match(html, /autoCapitalize="none"/);
  });
  test(`${locale}: fetched sources retain retrieval provenance without implying a publication date or original webpage lines`, () => {
    const source = createKnowledgeDocument({ title: "Cedar web", content: "Cedar <script>text</script>", sourceUrl: "https://nodejs.org/", retrievedAt: Date.UTC(2026, 10, 1) }, "cedar", 1);
    const html = renderToStaticMarkup(createElement(Sources, { locale, sources: searchKnowledge([source], "Cedar") }));
    assert.match(html, de ? /Abgerufen/ : /Retrieved/); assert.match(html, de ? /nicht auf Webseitenzeilen/ : /not webpage lines/); assert.match(html, de ? /Quellendatum nicht angegeben/ : /Source date not supplied/);
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  });
  test(`${locale}: rendering source and terminal controls never probes localhost or starts downloads`, () => {
    const original = globalThis.fetch; let calls = 0;
    try { globalThis.fetch = async () => { calls++; throw Error("unexpected request"); }; renderToStaticMarkup(createElement(Terminal, { locale, busy: false, onAiRequest: noop })); renderToStaticMarkup(createElement(Library, { locale, documents: [], onChange: noop, busy: false, persisted: true })); assert.equal(calls, 0); }
    finally { globalThis.fetch = original; }
  });
}
