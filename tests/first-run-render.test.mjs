// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { initialSessionState } from "../lib/conversation-session.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { defaultCpuModel } from "../lib/cpu-models.ts";

const UsernameOnboarding = await loadComponent(new URL("../app/username-onboarding.tsx", import.meta.url));
const AiOnboarding = await loadComponent(new URL("../app/ai-onboarding.tsx", import.meta.url));
const props = { username: "Alen", usernamePersisted: true, engine: "chat", state: initialSessionState, selected: defaultConversationModel, budget: {}, busy: false, clearing: false, onLocaleChange() {}, onEngineChange() {}, onBack() {}, onFinish() {}, onBudgetChange() {}, onSelect() {}, onLoad() {}, onCancel() {}, onUnload() {}, onDeleteCache() {} };
const primary = html => html.match(/<button\b[^>]*class="primary-button"[^>]*>[\s\S]*?<\/button>/)?.[0];

for (const locale of ["en", "de"]) {
  test(`${locale}: username is the first of two steps and leads to AI setup`, () => {
    const html = renderToStaticMarkup(createElement(UsernameOnboarding, { locale, initial: "Alen", onLocaleChange() {}, onComplete() {} }));
    assert.match(html, /01 \/ 02/); assert.match(html, /value="Alen"/);
    assert.match(html, locale === "de" ? /Weiter zur AI-Einrichtung/ : /Continue to AI setup/);
    assert.match(html, /Copyright © 2026 Alen Pepa/);
  });

  test(`${locale}: the local path clearly explains supported tasks and can start without a GPU or download`, () => {
    const html = renderToStaticMarkup(createElement(AiOnboarding, { ...props, locale, engine: "tools", classifierName: "AELVOR Hybrid v2" }));
    assert.match(html, /02 \/ 02/); assert.match(html, /AELVOR Hybrid v2/);
    assert.doesNotMatch(primary(html), /disabled=/);
    assert.match(primary(html), locale === "de" ? /Lokalen Assistenten starten/ : /Start local assistant/);
    assert.match(html, locale === "de" ? /Kein Modelldownload/ : /No model download/);
    assert.doesNotMatch(html, /id="gpu-vendor-preference"/);
  });

  test(`${locale}: selected models cannot look ready before loading and an explicit Load later choice remains available`, () => {
    const html = renderToStaticMarkup(createElement(AiOnboarding, { ...props, locale }));
    assert.match(primary(html), /disabled=/);
    assert.match(html, locale === "de" ? /Gewählt, nicht geladen/ : /Selected, not loaded/);
    assert.match(html, locale === "de" ? /Dieses Modell nutzen · Später laden/ : /Use this model · Load later/);
    const ready = renderToStaticMarkup(createElement(AiOnboarding, { ...props, locale, state: { ...initialSessionState, status: "ready", modelId: defaultConversationModel } }));
    assert.doesNotMatch(primary(ready), /disabled=/);
    const different = renderToStaticMarkup(createElement(AiOnboarding, { ...props, locale, state: { ...initialSessionState, status: "ready", modelId: defaultCpuModel } }));
    assert.match(primary(different), /disabled=/);
  });

  test(`${locale}: loading prevents completion and missing profile storage remains visible`, () => {
    const html = renderToStaticMarkup(createElement(AiOnboarding, { ...props, locale, usernamePersisted: false, state: { ...initialSessionState, status: "loading", modelId: defaultConversationModel } }));
    assert.match(primary(html), /disabled=/);
    assert.match(html, locale === "de" ? /Laden abbrechen &amp; Namen ändern/ : /Cancel loading &amp; edit username/);
    assert.match(html, locale === "de" ? /Benutzername gilt für diesen Besuch/ : /username is active for this visit/);
  });
}
