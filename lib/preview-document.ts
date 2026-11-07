// Copyright © 2026 Alen Pepa
import type { CompiledPreview } from "./preview-compiler-core.ts";
import { COPYRIGHT_NOTICE } from "./brand.ts";
import { resolvePreviewPath } from "./artifact-project.ts";
export const previewCsp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; media-src data: blob:";
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Runs only in the opaque-origin preview iframe, never in the workspace.
function bootstrap(payload: { result: CompiledPreview; runtime: string; token: string }, resolvePath: typeof resolvePreviewPath) {
  const { project, modules } = payload.result;
  let failed = false, logs = 0;
  const send = (type: string, text = "", level = "log") => { if (parent !== window) parent.postMessage({ channel: "aelvor-preview", token: payload.token, type, text: text.slice(0, 1200), level }, "*"); };
  const fatal = (error: unknown) => { failed = true; send("error", error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error), "error"); };
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => { original(...values); if (logs++ < 80) send("log", values.map(value => { try { return typeof value === "string" ? value : JSON.stringify(value) ?? String(value); } catch { return String(value); } }).join(" "), level); };
  }
  addEventListener("error", event => fatal(event.error || event.message));
  addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => fatal(event.reason));
  addEventListener("submit", event => event.preventDefault(), true);
  addEventListener("click", event => { const link = (event.target as Element)?.closest?.("a[href]"); if (link && !link.getAttribute("href")?.startsWith("#")) event.preventDefault(); }, true);
  try {
    const runtime = new Function(payload.runtime + ";return AelvorPreviewRuntime;")();
    const globals = window as unknown as Record<string, unknown>;
    globals.React = runtime.React; globals.ReactDOM = { ...runtime.ReactDOM, ...runtime.requirePackage("react-dom/client") };
    const files = new Map(project.files.map(file => [file.path, file]));
    const cache: Record<string, { exports: unknown }> = Object.create(null), styled = new Set<string>();
    const css = (path: string) => { if (styled.has(path)) return; styled.add(path); const style = document.createElement("style"); style.textContent = files.get(path)!.content; document.head.appendChild(style); };
    const load = (path: string): any => {
      if (Object.hasOwn(cache, path)) return cache[path].exports;
      const file = files.get(path); if (!file) throw Error("Missing local file: " + path);
      if (/\.css$/i.test(path)) { css(path); return {}; }
      if (/\.json$/i.test(path)) { const exports = JSON.parse(file.content); cache[path] = { exports }; return exports; }
      const code = modules[path]; if (code === undefined) throw Error("Not a JavaScript module: " + path);
      const module = { exports: {} }; cache[path] = module;
      const require = (name: string) => {
        if (["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"].includes(name)) return runtime.requirePackage(name);
        const target = resolvePath(path, name, project.files); if (!target) throw Error("Unavailable import: " + name); return load(target);
      };
      new Function("module", "exports", "require", "React", "ReactDOM", code)(module, module.exports, require, globals.React, globals.ReactDOM);
      return module.exports;
    };
    const entry = files.get(project.entry)!;
    if (/\.(html?|svg)$/i.test(project.entry)) {
      const parsed = new DOMParser().parseFromString(entry.content, "text/html");
      const scripts = Array.from(parsed.querySelectorAll("script"));
      const sheets = Array.from(parsed.querySelectorAll('link[rel="stylesheet"]')).map(node => node.getAttribute("href") || "");
      const styles = Array.from(parsed.querySelectorAll("style")).map(node => node.textContent || "");
      document.title = parsed.title || "AELVOR Preview";
      for (const node of parsed.querySelectorAll("script,link,meta,base,iframe,frame,object,embed,style")) node.remove();
      document.body.innerHTML = parsed.body.innerHTML;
      for (const attribute of Array.from(parsed.body.attributes)) document.body.setAttribute(attribute.name, attribute.value);
      for (const attribute of Array.from(parsed.documentElement.attributes)) document.documentElement.setAttribute(attribute.name, attribute.value);
      for (const text of styles) { const style = document.createElement("style"); style.textContent = text; document.head.appendChild(style); }
      for (const href of sheets) { const path = resolvePath(project.entry, href, project.files); if (path && /\.css$/i.test(path)) css(path); else throw Error("Unavailable stylesheet: " + href + ". Include it as a local CSS file."); }
      globals.require = (name: string) => { const path = resolvePath(project.entry, name, project.files); if (path) return load(path); return runtime.requirePackage(name); };
      for (const script of scripts) {
        const type = (script.getAttribute("type") || "").toLowerCase();
        if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
        const source = script.getAttribute("src") || script.getAttribute("href");
        if (source) { const path = resolvePath(project.entry, source, project.files); if (!path) throw Error("Unavailable script: " + source + ". Include it as a local JavaScript file."); if (type !== "module" && /\.js$/i.test(path)) (0, eval)(files.get(path)!.content + `\n//# sourceURL=aelvor-preview/${path}`); else load(path); }
        else { if (type === "module") throw Error("Move inline module code into a local .js/.jsx/.tsx file and reference it with script src."); (0, eval)(script.textContent || ""); }
      }
    } else {
      document.body.innerHTML = '<div id="root"></div>';
      for (const file of project.files) if (/\.css$/i.test(file.path)) css(file.path);
      const entryModule = load(project.entry);
      const component = typeof entryModule === "function" ? entryModule : entryModule?.default || entryModule?.App;
      if (component) runtime.mount(component, document.getElementById("root"), fatal);
      else if (/\.(jsx|tsx)$/i.test(project.entry) && Object.keys(entryModule || {}).length) throw Error("Export a default React component or an App component, or select a file that renders with createRoot().");
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!failed) send("ready"); }));
  } catch (error) { fatal(error); }
}

export function buildPreviewDocument(result: CompiledPreview, runtime: string, token: string): string {
  if (result.issues.length) throw Error("Fix compile issues before running the preview.");
  return `<!doctype html>\n<!-- ${COPYRIGHT_NOTICE} -->\n<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AELVOR Preview</title><style>html,body{margin:0;min-height:100%;}body{font-family:system-ui,sans-serif;}</style></head><body><script>(${bootstrap.toString()})(${json({ result, runtime, token })},${resolvePreviewPath.toString()});</script></body></html>`;
}
