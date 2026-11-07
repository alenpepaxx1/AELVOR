// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";

// Vinext writes these runtime manifests directly after the bundler finishes.
// Bundled chunks must receive their notices before their hashes are calculated.
const manifests = new Set(["_buildManifest.js", "_ssgManifest.js", "__vite_rsc_assets_manifest.js", "vinext-client-assets.js"]);
const banner = `/*! ${COPYRIGHT_NOTICE}. AELVOR application integration; third-party notices retained. */`;
function files(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]);
}
let updated = 0;
for (const file of files("dist").filter(file => /\.[cm]?js$/.test(file))) {
  const code = readFileSync(file, "utf8");
  // Vite may prepend its dependency mapper ahead of the bundle's banner.
  if (code.includes(banner)) continue;
  assert.ok(manifests.has(basename(file)), `Bundled chunk lacks copyright banner: ${file}`);
  writeFileSync(file, `${banner}\n${code}`);
  updated++;
}
console.log(`Copyright finalized in ${updated} generated runtime manifests.`);
