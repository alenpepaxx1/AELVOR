// Copyright © 2026 Alen Pepa
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import ts from "typescript";

const modules = new Map();
async function componentModule(file) {
  if (modules.has(file.href)) return modules.get(file.href);
  const source = await readFile(file, "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  for (const match of [...outputText.matchAll(/from (["'])([^"']+)\1/g)]) {
    const specifier = match[2]; let resolved;
    if (specifier.startsWith(".")) {
      let target = new URL(specifier, file);
      if (!/\.[cm]?[jt]sx?$/.test(target.pathname)) {
        const typed = new URL(`${specifier}.ts`, file);
        target = existsSync(typed) ? typed : new URL(`${specifier}.tsx`, file);
      }
      resolved = target.pathname.endsWith(".tsx") ? await componentModule(target) : target.href;
    } else resolved = import.meta.resolve(specifier);
    outputText = outputText.replace(match[0], `from ${JSON.stringify(resolved)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  modules.set(file.href, url); return url;
}
export async function loadComponent(file, exportName = "default") { return (await import(await componentModule(file)))[exportName]; }
