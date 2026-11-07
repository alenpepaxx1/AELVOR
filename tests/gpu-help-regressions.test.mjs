// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";

const GpuSelectionPanel = await loadComponent(new URL("../app/gpu-selection-panel.tsx", import.meta.url));
const base = { device: { gpu: "available", gpuName: "Intel Iris Xe", gpuVendor: "intel", os: "windows" }, checking: false, disabled: false, preference: "auto", locale: "en", refresh() {}, onChange() {} };
const guide = html => html.match(/<details\b[^>]*class="[^"]*gpu-windows-guide[^"]*"[^>]*>/)?.[0];

test("Automatic mode exposes GPU activation steps when the browser only reports integrated Intel graphics", () => {
  const html = renderToStaticMarkup(createElement(GpuSelectionPanel, base));
  assert.match(guide(html), /open=/);
  assert.match(html, /Dedicated GPU not confirmed/);
  assert.doesNotMatch(html, /High performance with your NVIDIA RTX GPU/);
});

test("a pending GPU probe does not prematurely open a missing-GPU diagnosis", () => {
  const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, device: null, checking: true, preference: "nvidia" }));
  assert.doesNotMatch(guide(html), /open=/);
  assert.doesNotMatch(html, /Dedicated GPU not confirmed/);
});

test("worker GPU rejection keeps activation steps visible even when the browser probe itself reports NVIDIA", () => {
  const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, device: { ...base.device, gpuName: "NVIDIA RTX 4060", gpuVendor: "nvidia" }, preference: "nvidia", runtimeError: "gpu_selection_nvidia_mismatch" }));
  assert.match(guide(html), /open=/);
  assert.match(html, /model worker|Model worker/);
});

for (const locale of ["en", "de"]) {
  test(`${locale}: activation guidance explains acceleration, card status, driver checks and model reload`, () => {
    const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale }));
    assert.match(html, /chrome:\/\/settings\/system/);
    assert.match(html, /edge:\/\/settings\/system/);
    assert.match(html, locale === "de" ? /Geräte-Manager/ : /Device Manager/);
    assert.match(html, locale === "de" ? /Treiber/ : /drivers/);
    assert.match(html, locale === "de" ? /Erneutes Prüfen allein wechselt/ : /Checking again alone does not switch/);
    assert.match(html, locale === "de" ? /Entladen/ : /Unload/);
  });

  test(`${locale}: mobile failures do not prescribe Windows or a separate NVIDIA card`, () => {
    const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, locale, device: { ...base.device, gpu: "unavailable", gpuName: "", os: "ios" } }));
    assert.match(guide(html), /open=/);
    assert.match(html, locale === "de" ? /Smartphones und Tablets nutzen ihre integrierte GPU/ : /Phones and tablets use their built-in GPU/);
    assert.doesNotMatch(html, /Device Manager|Geräte-Manager|Display → Graphics|Anzeige → Grafik|chrome:\/\//);
  });
}

test("known macOS does not receive Windows-only routing instructions", () => {
  const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, device: { ...base.device, os: "macos", gpuName: "", gpuVendor: "unknown" } }));
  assert.match(guide(html), /open=/);
  assert.doesNotMatch(html, /Device Manager|Windows: open|Windows GPU settings/);
  assert.match(html, /Apple silicon/);
});

test("a new NVIDIA probe never relabels the GPU of an already loaded Intel model", () => {
  const html = renderToStaticMarkup(createElement(GpuSelectionPanel, { ...base, device: { ...base.device, gpuName: "NVIDIA RTX 4060", gpuVendor: "nvidia" }, loadedGpu: { name: "Intel Iris Xe", vendor: "intel", software: false, source: "model-worker" } }));
  assert.match(html, /Browser and model report different GPUs/);
  assert.match(html, /<dt>Loaded model GPU<\/dt><dd>Intel Iris Xe<\/dd>/);
  assert.match(html, /Unload/);
});
