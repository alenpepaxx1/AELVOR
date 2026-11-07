// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { gpuCapacitySuggestion } from "../lib/model-capacity.ts";

const AssistantSettings = await loadComponent(new URL("../app/assistant-settings.tsx", import.meta.url));
const ModelCapacitySuggestion = await loadComponent(new URL("../app/model-capacity-suggestion.tsx", import.meta.url));
const device = { checkedAt: 1, cpuThreads: 16, ramEstimateGB: 32, gpu: "available", gpuName: "", features: ["shader-f16"], maxBufferBytes: 2 ** 30, maxStorageBufferBytes: 2 ** 30, maxComputeWorkgroupStorageBytes: 32768, maxStorageBuffersPerStage: 10, cacheAvailableGB: 50, workerAvailable: true };
const budget = { ramGB: 32, gpuGB: 12 };

for (const locale of ["en", "de"]) {
  test(`${locale}: adaptive settings show all approaches and restore the selected preference`, () => {
    const html = renderToStaticMarkup(createElement(AssistantSettings, { locale, value: { style: "balanced", instructions: "", approach: "precise" }, onSave() {} }));
    assert.match(html, locale === "de" ? /Antwortansatz/ : /Response approach/);
    assert.match(html, locale === "de" ? /aria-pressed="true"[^>]*>Präzise<\/button>/ : /aria-pressed="true"[^>]*>Precise<\/button>/);
    assert.match(html, locale === "de" ? /Adaptiv/ : /Adaptive/);
    assert.match(html, locale === "de" ? /Kreativ/ : /Creative/);
    assert.match(html, locale === "de" ? /trainieren das Modell nicht neu/ : /do not retrain the model/);
  });

  test(`${locale}: capacity suggestions require explicit selection and disappear when hardware fails`, () => {
    let selections = 0;
    const props = { device, budget, selected: "another-model", disabled: false, locale, onSelect() { selections++; } };
    const html = renderToStaticMarkup(createElement(ModelCapacitySuggestion, props));
    assert.match(html, /Qwen3.*8B/);
    assert.match(html, locale === "de" ? /Modell auswählen/ : /Select model/);
    assert.match(html, locale === "de" ? /Erst auswählen/ : /Select first/);
    assert.equal(selections, 0);
    const selected = renderToStaticMarkup(createElement(ModelCapacitySuggestion, { ...props, selected: gpuCapacitySuggestion(device, budget).id }));
    assert.match(selected, /disabled=""/);
    const blocked = renderToStaticMarkup(createElement(ModelCapacitySuggestion, { ...props, device: { ...device, gpu: "unavailable" } }));
    assert.equal(blocked, "");
  });
}
