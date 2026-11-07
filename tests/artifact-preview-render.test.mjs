// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { extractArtifacts } from "../lib/local-tools.ts";
const Markdown = await loadComponent(new URL("../app/markdown.tsx", import.meta.url));
const Workbench = await loadComponent(new URL("../app/artifact-workbench.tsx", import.meta.url));

for (const locale of ["en", "de"]) {
  test(`${locale}: web code offers a preview action while Python and unfinished output remain code-only`, () => {
    const props = { locale, onNotice() {}, onOpen() {} };
    const html = renderToStaticMarkup(createElement(Markdown, { ...props, text: '```html\n<button>Hi</button>\n```' }));
    assert.match(html, locale === "de" ? /App-Vorschau öffnen/ : /Open app preview/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(Markdown, { ...props, text: '```python\nprint("hi")\n```' })), /code-preview-button/);
    for (const extra of [{ text: '```html\n<div>Still generating' }, { text: '```html\n<div>Complete block</div>\n```', pending: true }]) {
      const pending = renderToStaticMarkup(createElement(Markdown, { ...props, ...extra }));
      assert.match(pending, /class="code-preview-button" disabled=""/);
    }
  });
  test(`${locale}: the workbench includes file editing, viewport controls, run, stop and export without executing on render`, () => {
    const artifacts = extractArtifacts([{ id: "one", role: "assistant", content: '```tsx filename=src/App.tsx\nexport default ()=> <main>Hello</main>\n```' }]);
    const html = renderToStaticMarkup(createElement(Workbench, { artifact: artifacts[0], artifacts, locale, active: true, onNotice() {} }));
    assert.match(html, /src\/App.tsx/); assert.match(html, /1024.*720/);
    assert.match(html, locale === "de" ? /Vorschau-Quellcode bearbeiten/ : /Edit preview source code/);
    assert.match(html, locale === "de" ? /App exportieren/ : /Export app/);
    assert.match(html, locale === "de" ? /temporär/ : /temporary/);
    assert.doesNotMatch(html, /<iframe/);
  });
}
