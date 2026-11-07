// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { loadedGpuFromProgress } from "../lib/gpu-selection.ts";

const GpuSelectionPanel = await loadComponent(new URL("../app/gpu-selection-panel.tsx", import.meta.url));
const device = { gpu: "available", gpuName: "Intel Iris Xe", gpuVendor: "intel" };
const base = { device, checking: false, disabled: false, preference: "nvidia", refresh() {}, onChange() {} };

for (const locale of ["en", "de"]) {
  test(`${locale}: NVIDIA selection explains the Intel mismatch and provides Windows routing steps`, () => {
    const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale }));
    assert.match(html, /<option value="nvidia" selected="">/);
    assert.match(html, /Intel Iris Xe/); assert.match(html, /role="status"/);
    assert.match(html, locale === "de" ? /NVIDIA ist erforderlich/ : /NVIDIA is required/);
    assert.match(html, locale === "de" ? /Hohe Leistung mit deiner NVIDIA RTX-GPU/ : /High performance with your NVIDIA RTX GPU/);
    assert.match(html, locale === "de" ? /vollständig neu/ : /Fully restart/);
    assert.match(html, locale === "de" ? /keine Liste installierter Karten/ : /not a list of installed cards/);
  });

  test(`${locale}: model GPU identity is separate from a new browser probe and controls lock while loading`, () => {
    const loadedGpu = loadedGpuFromProgress({ progress: 1, text: "Finish loading on WebGPU - NVIDIA GeForce RTX 4060" });
    const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale, loadedGpu, disabled: true }));
    assert.match(html, /NVIDIA GeForce RTX 4060/); assert.match(html, /Intel Iris Xe/);
    assert.match(html, locale === "de" ? /GPU des geladenen Modells/ : /Loaded model GPU/);
    assert.match(html, /<select[^>]*disabled=""/);
    assert.match(html, /<button[^>]*disabled=""/);
  });
}

test("AMD and Intel GPU guidance names the selected manufacturer without promising an NVIDIA switch", () => {
  const amd = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale: "en", preference: "amd" }));
  assert.match(amd, /High performance with your AMD Radeon GPU/);
  const intel = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale: "en", preference: "intel" }));
  assert.match(intel, /entry listing your Intel GPU/);
  assert.doesNotMatch(intel, /High performance with your NVIDIA RTX GPU/);
});
