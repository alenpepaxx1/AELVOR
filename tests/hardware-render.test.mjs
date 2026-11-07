// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { defaultCpuModel } from "../lib/cpu-models.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { initialSessionState } from "../lib/conversation-session.ts";

const Setup = await loadComponent(new URL("../app/conversation-setup.tsx", import.meta.url));
const props = { budget: {}, state: initialSessionState, onBudgetChange() {}, onSelect() {}, onLoad() {}, onCancel() {}, onUnload() {}, onDeleteCache() {}, busy: false, clearing: false };
for (const locale of ["en", "de"]) {
  test(`${locale}: CPU setup exposes real CPU models and the RAM check without requiring a GPU model`, () => {
    const html = renderToStaticMarkup(createElement(Setup, { ...props, selected: defaultCpuModel, locale }));
    assert.match(html, /NVIDIA · AMD · Intel · WebGPU/); assert.match(html, /AMD · Intel · ARM · WebAssembly/);
    assert.match(html, /Qwen 0.5B · CPU/); assert.match(html, /Qwen 1.5B · CPU/);
    assert.match(html, /4 GB RAM/); assert.match(html, /8 GB RAM/);
    assert.match(html, locale === "de" ? /Keine GPU erforderlich/ : /No GPU required/);
    assert.match(html, /class="activate-conversation[^>]*disabled=/);
    assert.doesNotMatch(html, /CPU-only inference is not supported/);
  });
  test(`${locale}: GPU setup keeps the existing catalog alongside the CPU alternative`, () => {
    const html = renderToStaticMarkup(createElement(Setup, { ...props, selected: defaultConversationModel, locale }));
    assert.match(html, /159/); assert.match(html, locale === "de" ? /Gesamte Modellbibliothek/ : /Full model library/);
    assert.match(html, locale === "de" ? /CPU-Kompatibilität/ : /CPU compatibility/);
    assert.match(html, locale === "de" ? /standardmäßig GPU-Beschleunigung/ : /GPU acceleration by default/);
    assert.match(html, locale === "de" ? /unbemerkt zur CPU/ : /silently switching to CPU/);
    assert.match(html, /class="activate-conversation[^>]*disabled=/);
  });
  test(`${locale}: switching to CPU hides a stale GPU failure and shows CPU-specific resource errors`, () => {
    const stale = renderToStaticMarkup(createElement(Setup, { ...props, selected: defaultCpuModel, locale, state: { ...initialSessionState, status: "error", modelId: defaultConversationModel, error: "model_resources_webgpu" } }));
    assert.doesNotMatch(stale, /class="conversation-error"/);
    const current = renderToStaticMarkup(createElement(Setup, { ...props, selected: defaultCpuModel, locale, state: { ...initialSessionState, status: "error", modelId: defaultCpuModel, error: "cpu_resources_ram-budget" } }));
    assert.match(current, /class="conversation-error"/); assert.match(current, /RAM/);
  });
}
