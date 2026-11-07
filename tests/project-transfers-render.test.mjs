// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/render-component.mjs";
import { createProjectScaffold } from "../lib/project-scaffolds.ts";
const Transfers = await loadComponent(new URL("../app/project-transfers.tsx", import.meta.url));
for (const locale of ["en", "de"]) test(`${locale}: project transfers show real import/export actions and disclose Drive handoff`, () => {
  const project = createProjectScaffold("react", "My App", "com.example.app", "test", locale, 1);
  const html = renderToStaticMarkup(createElement(Transfers, { project, locale, canImport: true, onImport() { assert.fail("Render must never import"); } }));
  assert.match(html, /GitHub/); assert.match(html, /Google Drive/); assert.match(html, /webkitdirectory=""/);
  for (const text of locale === "de" ? ["Ordner importieren", "ZIP importieren", "Quellcode laden", "ZIP speichern unter", "ZIP an Drive teilen", "direkter Upload über ein Drive-Konto ist nicht eingerichtet", "Binär-Assets"] : ["Import folder", "Import ZIP", "Fetch source", "Save ZIP as", "Share ZIP to Drive", "direct Drive account upload is not configured", "binary assets"]) assert.ok(html.includes(text), text);
  assert.match(html, /https:\/\/drive.google.com\/drive\/my-drive/); assert.match(html, /rel="noreferrer noopener"/);
  assert.doesNotMatch(html, /uploaded successfully|Upload erfolgreich|<iframe|<script/);
});
