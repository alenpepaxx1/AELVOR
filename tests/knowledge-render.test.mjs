// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { createKnowledgeDocument } from "../lib/knowledge-library.ts";
import { searchKnowledge } from "../lib/knowledge-retrieval.ts";

const KnowledgeLibrary = await loadComponent(new URL("../app/knowledge-library.tsx", import.meta.url));
const KnowledgeSources = await loadComponent(new URL("../app/knowledge-sources.tsx", import.meta.url));
const source = createKnowledgeDocument({ title: "Cedar <notes>", content: "Cedar <script>alert('text only')</script>\nSecond line", sourceDate: "2026-10-31", sourceUrl: "https://example.org/cedar" }, "cedar", 100);

for (const locale of ["en", "de"]) {
  test(`${locale}: local knowledge has import, export, source controls and truthful limits`, () => {
    let writes = 0;
    const html = renderToStaticMarkup(createElement(KnowledgeLibrary, { documents: [source], onChange() { writes++; return true; }, locale, busy: false, persisted: true }));
    assert.match(html, locale === "de" ? /Textdateien importieren/ : /Import text files/);
    assert.match(html, locale === "de" ? /Bibliothek exportieren/ : /Export library/);
    assert.match(html, locale === "de" ? /trainiert aber kein Modell/ : /not model training/);
    assert.match(html, locale === "de" ? /Manuell eingegebene URLs kennzeichnen Quellen/ : /Manually entered URLs are source labels/);
    assert.match(html, /checked=""/); assert.match(html, /2026-10-31/);
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
    assert.equal(writes, 0);
  });
  test(`${locale}: failed storage shows retry controls and a busy library locks changes`, () => {
    const html = renderToStaticMarkup(createElement(KnowledgeLibrary, { documents: [source], onChange() {}, locale, busy: true, persisted: false }));
    assert.match(html, locale === "de" ? /Für diesen Besuch aktiv/ : /Active for this visit/);
    assert.match(html, locale === "de" ? /Erneut speichern/ : /Retry saving/);
    assert.match(html, locale === "de" ? /frühere Quellen.*Neuladen.*zurückkehren/ : /previous sources.*return after reload/);
    assert.match(html, /type="checkbox"[^>]*disabled=""/);
    assert.match(html, /<button[^>]*disabled=""/);
  });
  test(`${locale}: source details show exact saved evidence without claiming verified citations`, () => {
    const sources = searchKnowledge([source], "Cedar");
    const html = renderToStaticMarkup(createElement(KnowledgeSources, { sources, locale }));
    assert.match(html, /\[K1\]/); assert.match(html, /2026-10-31/);
    assert.match(html, locale === "de" ? /Zeilen/ : /Lines/);
    assert.match(html, locale === "de" ? /prüft weder die Quellen/ : /does not verify the sources/);
    assert.match(html, locale === "de" ? /Quellenlink öffnen/ : /Open source link/);
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
    assert.equal(renderToStaticMarkup(createElement(KnowledgeSources, { sources: [], locale })), "");
  });
}
