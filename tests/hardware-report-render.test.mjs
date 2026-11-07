// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { hardwareFixture, hardwareBrowser } from "./support/hardware-fixtures.mjs";

const file = new URL("../app/hardware-report-panel.tsx", import.meta.url);
const HardwareReportPanel = await loadComponent(file);
const HardwareReportDetails = await loadComponent(file, "HardwareReportDetails");
const HardwareBudgetControls = await loadComponent(file, "HardwareBudgetControls");
const button = (html, label) => [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => match[0].includes(label))?.[0];

for (const locale of ["en", "de"]) {
  test(`${locale}: native details keep every reported CPU/GPU and show dedicated VRAM separately from shared limits`, () => {
    const html = renderToStaticMarkup(createElement(HardwareReportDetails, { report: hardwareFixture(), locale }));
    assert.match(html, /Intel Core i7-14700K/); assert.match(html, /AMD Ryzen 9 9950X/);
    assert.match(html, /NVIDIA GeForce RTX 4090/); assert.match(html, /Intel UHD Graphics 770/); assert.match(html, /AMD Radeon RX 7900 XTX/);
    assert.match(html, /64 GiB/); assert.match(html, /24 GiB/); assert.match(html, /32 GiB/);
    assert.ok(html.includes((24 * 2 ** 30).toLocaleString(locale) + " bytes"));
    assert.match(html, locale === "de" ? /nicht vom Browser verifiziert/ : /not browser-verified/);
    assert.match(html, locale === "de" ? /Dedizierter VRAM/ : /Dedicated VRAM/);
    assert.match(html, locale === "de" ? /Limit für geteilten Systemspeicher/ : /Shared system memory limit/);
    assert.match(html, locale === "de" ? /Nicht gemeldet/ : /Not reported/);
    assert.doesNotMatch(html, /56 GiB/);
  });

  test(`${locale}: report controls refuse RTX memory on an Intel adapter but permit a matched RTX budget`, () => {
    const props = { report: hardwareFixture(), budget: {}, onBudgetChange() {}, disabled: false, backend: "webgpu", locale };
    const label = locale === "de" ? "VRAM-Budget der passenden GPU nutzen" : "Use matched GPU VRAM budget";
    const matched = renderToStaticMarkup(createElement(HardwareBudgetControls, { ...props, device: hardwareBrowser() }));
    assert.doesNotMatch(button(matched, label), /disabled=/);
    const mismatch = renderToStaticMarkup(createElement(HardwareBudgetControls, { ...props, device: hardwareBrowser("Intel Iris Xe") }));
    assert.match(button(mismatch, label), /disabled=/);
    assert.match(mismatch, locale === "de" ? /wechseln einen Intel-Adapter nicht zu RTX/ : /does not switch an Intel adapter to RTX/);
    const phone = renderToStaticMarkup(createElement(HardwareBudgetControls, { ...props, device: { ...hardwareBrowser(), mobile: { mobile: true } } }));
    assert.match(button(phone, locale === "de" ? "Gemeldetes RAM-Budget nutzen" : "Use reported RAM budget"), /disabled=/);
  });

  test(`${locale}: the collector is an explicit local download/import workflow with an honest detection limit`, () => {
    const html = renderToStaticMarkup(createElement(HardwareReportPanel, { locale, device: hardwareBrowser(), budget: {}, onBudgetChange() {}, disabled: false, backend: "webgpu" }));
    assert.match(html, /href="\/hardware\/aelvor-hardware\.ps1"/); assert.match(html, /download="aelvor-hardware.ps1"/);
    assert.match(html, locale === "de" ? /100-%-Erkennung ist nicht garantiert/ : /100% detection cannot be guaranteed/);
    assert.match(html, /64-[Bb]it/); assert.match(html, /Copyright © 2026 Alen Pepa/);
    assert.match(html, locale === "de" ? /Hardwarebericht importieren/ : /Import hardware report/);
  });
}
