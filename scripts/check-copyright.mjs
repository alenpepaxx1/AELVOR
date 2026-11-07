// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";

const codeExtensions = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".css", ".py", ".sh", ".ps1", ".svg", ".html", ".sql", ".yaml", ".yml"]);
const source = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0"))]
  .filter(file => file && file !== "pnpm-lock.yaml" && codeExtensions.has(extname(file)));
for (const file of source) {
  const head = readFileSync(file, "utf8").split(/\r?\n/).slice(0, 12).join("\n");
  assert.ok(head.includes(COPYRIGHT_NOTICE), `Missing source copyright: ${file}`);
}
console.log(`Copyright verified in ${source.length} source files.`);

if (process.argv.includes("--built")) {
  function files(folder) {
    return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]);
  }
  const built = files("dist").filter(file => /\.(?:[cm]?js|css|py|ps1|svg)$/.test(file));
  assert.ok(built.length > 0, "No built application code found");
  for (const file of built) {
    const head = readFileSync(file, "utf8").split(/\r?\n/).slice(0, 12).join("\n");
    assert.ok(head.includes(COPYRIGHT_NOTICE), `Missing built copyright: ${file}`);
  }
  console.log(`Copyright verified in ${built.length} deployed assets.`);
}
