// Copyright © 2026 Alen Pepa
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";
const entry = fileURLToPath(new URL("../lib/preview-react-runtime.tsx", import.meta.url));
const directory = fileURLToPath(new URL("../public/preview", import.meta.url));
await build({ configFile: false, publicDir: false, logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { emptyOutDir: false, outDir: directory, lib: { entry, name: "AelvorPreviewRuntime", formats: ["iife"], fileName: () => "aelvor-preview-runtime.js" } } });
const path = `${directory}/aelvor-preview-runtime.js`;
const text = await readFile(path, "utf8");
const notices = [];
for (const [name, license] of [["react", "LICENSE"], ["react-dom", "LICENSE"], ["lucide-react", "LICENSE"]]) {
  const root = dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
  notices.push(`${name}\n${await readFile(join(root, license), "utf8")}`);
}
const combined = notices.join("\n\n");
const banner = `/*! ${COPYRIGHT_NOTICE}. AELVOR application integration; third-party notices retained. */`;
await writeFile(path, `${banner}\n${text}\n/* Third-party license notices\n${combined.replace(/\*\//g, "* /")}\n*/\n`);
const compiler = fileURLToPath(new URL("../lib/artifact-preview.worker.ts", import.meta.url));
await build({ configFile: false, publicDir: false, logLevel: "error", define: { "process.env.NODE_ENV": '"production"' }, build: { emptyOutDir: false, outDir: directory, lib: { entry: compiler, name: "AelvorPreviewCompiler", formats: ["iife"], fileName: () => "aelvor-preview-compiler.js" } } });
const compilerPath = `${directory}/aelvor-preview-compiler.js`;
await writeFile(compilerPath, `${banner}\n${await readFile(compilerPath, "utf8")}`);
const typescript = dirname(fileURLToPath(import.meta.resolve("typescript/package.json")));
await writeFile(`${directory}/THIRD_PARTY_NOTICES.txt`, `AELVOR — Copyright © 2026 Alen Pepa\n\n${combined}\n\nTypeScript\n${await readFile(join(typescript, "LICENSE.txt"), "utf8")}\n${await readFile(join(typescript, "ThirdPartyNoticeText.txt"), "utf8")}`);
console.log("Browser-only React runtime and TSX compiler prepared as static assets.");
