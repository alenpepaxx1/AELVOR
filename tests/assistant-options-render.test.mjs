// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { defaultAssistantPreferences } from "../lib/assistant-preferences.ts";
const Settings = await loadComponent(new URL("../app/assistant-settings.tsx", import.meta.url));
const Context = await loadComponent(new URL("../app/conversation-context.tsx", import.meta.url));
const Refine = await loadComponent(new URL("../app/response-refine.tsx", import.meta.url));
const Markdown = await loadComponent(new URL("../app/markdown.tsx", import.meta.url));
const noop = () => {};
const source = { id: "cedar", title: "Cedar notes", content: 'Cedar gateway uses Boreal encryption.\n<script>alert("quoted")</script>', sourceUrl: "https://example.test", sourceDate: "2026-10-28", enabled: true, updatedAt: 1 };
for (const locale of ["en", "de"]) {
  const de = locale === "de";
  test(`${locale}: new response options show the saved selections and retain retry for failed writes`, () => {
    const value = { ...defaultAssistantPreferences, language: "de", format: "table", knowledge: "focused" };
    const html = renderToStaticMarkup(createElement(Settings, { value, locale, onSave: () => true }));
    assert.match(html, /value="de" selected=""/); assert.match(html, /value="table" selected=""/); assert.match(html, /value="focused" selected=""/);
    assert.match(html, de ? /Antwortsprache/ : /Reply language/); assert.match(html, de ? /Nummerierte Schritte/ : /Numbered steps/);
    assert.match(html, de ? /Antwort wird dadurch nicht geprüft/ : /does not verify the answer/);
    const failed = renderToStaticMarkup(createElement(Settings, { value, locale, persisted: false, onSave: () => false }));
    assert.match(failed, de ? /Erneut speichern/ : /Retry saving/); assert.match(failed, de ? /Speichern fehlgeschlagen/ : /Saving failed/);
  });
  test(`${locale}: context preview exposes real selected source snapshots and escapes supplied source`, () => {
    const request = { text: "What does Cedar use?", locale, characterBudget: 2400, preferences: defaultAssistantPreferences, knowledge: [source], history: [{ role: "user", content: "Earlier" }, { role: "assistant", content: "Earlier reply" }] };
    const html = renderToStaticMarkup(createElement(Context, { request, engine: "chat", locale, onClose: noop, onSettings: noop }));
    assert.match(html, de ? /Vor dem Senden/ : /Before you send/); assert.match(html, /2[.,]400/); assert.match(html, /Cedar notes/);
    assert.match(html, /Boreal encryption/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|<iframe/);
    assert.match(html, de ? /keine Token- oder Speichermessung/ : /not a token or memory measurement/);
  });
  test(`${locale}: library-off preview does not expose library evidence but retains explicit attachments`, () => {
    const request = { text: "What does Cedar use?", locale, preferences: { ...defaultAssistantPreferences, knowledge: "off" }, knowledge: [source], files: [{ name: "project.md", content: "Explicit project draft" }] };
    const html = renderToStaticMarkup(createElement(Context, { request, engine: "chat", locale, onClose: noop, onSettings: noop }));
    assert.doesNotMatch(html, /Boreal|Cedar notes/); assert.match(html, /Explicit project draft/); assert.match(html, de ? /Bibliothekssuche aus/ : /Library retrieval off/);
  });
  test(`${locale}: context overflow and empty input report preparation limits without sending anything`, () => {
    let sends = 0;
    const request = { text: "x".repeat(2500), locale, characterBudget: 2400, onText() { sends++; } };
    const html = renderToStaticMarkup(createElement(Context, { request, engine: "chat", locale, onClose: noop, onSettings: noop }));
    assert.match(html, /role="status"/); assert.equal(sends, 0);
    const empty = renderToStaticMarkup(createElement(Context, { request: { text: "", locale }, engine: "chat", locale, onClose: noop, onSettings: noop }));
    assert.match(empty, de ? /Dieses Panel sendet keine Anfrage/ : /No request is sent from this panel/);
  });
  test(`${locale}: local context and refine controls explain their actual behavior and disable actions while busy`, () => {
    const html = renderToStaticMarkup(createElement(Context, { request: { text: "Explain Cedar", locale, knowledge: [source] }, engine: "tools", locale, onClose: noop, onSettings: noop }));
    assert.match(html, de ? /ohne freie Antwortgenerierung/ : /without generating free-form answers/);
    const refine = renderToStaticMarkup(createElement(Refine, { locale, disabled: true, onApply: noop }));
    assert.equal((refine.match(/disabled=""/g) || []).length, 5); assert.match(refine, de ? /neuen Gesprächszweig/ : /new conversation branch/);
    assert.match(refine, de ? /Ins Englische übersetzen/ : /Translate to English/);
  });
  test(`${locale}: extractive source output containing nested fences remains escaped code`, () => {
    const text = '## Original excerpt\n````text\n```html\n<script>bad()</script>\n```\n````';
    const html = renderToStaticMarkup(createElement(Markdown, { text, locale, onNotice: noop, onOpen: noop }));
    assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|<iframe/);
  });
}
