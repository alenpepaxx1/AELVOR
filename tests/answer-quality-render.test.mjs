// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
const AnswerQuality = await loadComponent(new URL("../app/answer-quality.tsx", import.meta.url));
const AssistantSettings = await loadComponent(new URL("../app/assistant-settings.tsx", import.meta.url));
const ConversationContext = await loadComponent(new URL("../app/conversation-context.tsx", import.meta.url));
for (const locale of ["en", "de"]) {
  test(`${locale}: careful settings, context and answer checks explain self-review limits and recovery`, () => {
    const value = { style: "balanced", instructions: "", quality: "careful" };
    const settings = renderToStaticMarkup(createElement(AssistantSettings, { value, locale, onSave() {} }));
    assert.match(settings, locale === "de" ? /Sorgfältig · Entwurf/ : /Careful · draft/);
    assert.match(settings, locale === "de" ? /keine unabhängige Faktenprüfung/ : /not independent fact verification/);
    const context = renderToStaticMarkup(createElement(ConversationContext, { request: { text: "Calculate 2+2", locale, preferences: value }, engine: "chat", locale, onClose() {}, onSettings() {} }));
    assert.match(context, locale === "de" ? /eine Selbstprüfung/ : /one self-review/);
    assert.match(context, /Local arithmetic result/);
    const answer = renderToStaticMarkup(createElement(AnswerQuality, { locale, quality: { review: "review_failed", passes: 2, unknownCitations: ["K9"], unfinishedCodeBlocks: 1, arithmeticExpression: "2+2" } }));
    assert.match(answer, /\[K9\]/); assert.match(answer, locale === "de" ? /Entwurf behalten/ : /draft kept/);
    assert.match(answer, locale === "de" ? /Modell vor der nächsten/ : /Reload the local model/);
  });
}
