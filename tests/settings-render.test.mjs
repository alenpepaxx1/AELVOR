// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";

// Render the real form components in Node; this does not require a browser,
// microphone or model download. Resolve imports from the original source file.
const AssistantSettings = await loadComponent(new URL("../app/assistant-settings.tsx", import.meta.url));
const UsernameForm = await loadComponent(new URL("../app/username-form.tsx", import.meta.url));
const submitButton = html => html.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0];

for (const locale of ["en", "de"]) {
  test(`${locale}: reopening preferences after storage failure shows an enabled retry instead of a saved state`, () => {
    const props = { locale, value: { style: "concise", instructions: "Use short examples." }, onSave: () => false };
    const failed = renderToStaticMarkup(createElement(AssistantSettings, { ...props, persisted: false }));
    assert.doesNotMatch(submitButton(failed), /\bdisabled=/);
    assert.match(submitButton(failed), locale === "de" ? /Erneut speichern/ : /Retry saving/);
    assert.match(failed, /role="status"/);
    assert.match(failed, locale === "de" ? /Speichern fehlgeschlagen/ : /Saving failed/);
    const stored = renderToStaticMarkup(createElement(AssistantSettings, { ...props, persisted: true }));
    assert.match(submitButton(stored), /\bdisabled=/);
    assert.doesNotMatch(stored, /role="status"/);
  });

  test(`${locale}: a session username can be retried unchanged while persisted names stay disabled`, () => {
    const props = { locale, initial: "Jörg.dev", onSave() {} };
    const failed = renderToStaticMarkup(createElement(UsernameForm, { ...props, persisted: false }));
    assert.doesNotMatch(submitButton(failed), /\bdisabled=/);
    assert.match(submitButton(failed), locale === "de" ? /Erneut speichern/ : /Retry saving/);
    assert.match(failed, /role="status"/);
    const stored = renderToStaticMarkup(createElement(UsernameForm, { ...props, persisted: true }));
    assert.match(submitButton(stored), /\bdisabled=/);
    const invalid = renderToStaticMarkup(createElement(UsernameForm, { ...props, initial: "bad name", persisted: false }));
    assert.match(submitButton(invalid), /\bdisabled=/);
  });
}
