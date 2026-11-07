// Copyright © 2026 Alen Pepa
export const fileExtensions: Record<string, string> = { python: "py", javascript: "js", typescript: "ts", jsx: "jsx", tsx: "tsx", bash: "sh", sh: "sh", shell: "sh", powershell: "ps1", json: "json", yaml: "yml", html: "html", css: "css", sql: "sql", go: "go", rust: "rs", java: "java", cpp: "cpp", c: "c", markdown: "md", svg: "svg", kotlin: "kt", swift: "swift", dart: "dart", csharp: "cs", php: "php", ruby: "rb", lua: "lua", perl: "pl", r: "r", scala: "scala", elixir: "ex", erlang: "erl", haskell: "hs", julia: "jl", zig: "zig", nim: "nim", solidity: "sol", xml: "xml", toml: "toml", ini: "ini", properties: "properties", gradle: "gradle", cmake: "cmake", protobuf: "proto", dockerfile: "Dockerfile", makefile: "Makefile", text: "txt" };
const aliases: Record<string, string> = { js: "javascript", ts: "typescript", react: "jsx", javascriptreact: "jsx", typescriptreact: "tsx", html5: "html", py: "python", kt: "kotlin", kts: "kotlin", cs: "csharp", "c#": "csharp", "c++": "cpp", yml: "yaml", md: "markdown", rb: "ruby", rs: "rust", golang: "go", shellscript: "bash", ps1: "powershell", txt: "text" };
export function languageForPath(path: string): string {
  const name = path.split("/").at(-1)?.toLowerCase() || "";
  if (name === "dockerfile" || name === "makefile") return name;
  const ext = name.split(".").at(-1) || "";
  if (["kts"].includes(ext)) return "kotlin";
  if (["cc", "cxx", "hpp", "hh"].includes(ext)) return "cpp";
  if (["mjs", "cjs"].includes(ext)) return "javascript";
  if (["mts", "cts"].includes(ext)) return "typescript";
  if (["plist", "xcscheme", "storyboard", "xib"].includes(ext)) return "xml";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (["env", "gitignore", "editorconfig"].includes(name.replace(/^\./, ""))) return "text";
  return Object.entries(fileExtensions).find(([, extension]) => extension.toLowerCase() === ext)?.[0] || "text";
}
export function codeLanguage(value: string): string {
  const first = value.trim().split(/\s+/, 1)[0].toLowerCase();
  if (/[/.]/.test(first) && languageForPath(first) !== "text") return languageForPath(first);
  const language = first.replace(/[^a-z0-9+#-]/g, "").slice(0, 40) || "text";
  return Object.hasOwn(aliases, language) ? aliases[language] : language;
}
export function codeExtension(value: string): string { const language = codeLanguage(value); return Object.hasOwn(fileExtensions, language) ? fileExtensions[language] : "txt"; }
export const codePathCharacters = 240;
export function codeFilePath(value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = path.split("/");
  if (!path || path.length > codePathCharacters || path.startsWith("/") || !/^[A-Za-z0-9_./-]+$/.test(path) || parts.some(part => !part || part === "." || part === ".." || part.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || parts.some(part => part.toLowerCase() === ".git") || /\.(?:exe|dll|so|dylib|apk|ipa|jar|zip|png|jpe?g|gif|webp|pdf|wasm)$/i.test(path)) throw Error("code_project_path");
  return path;
}
export function explicitCodeFilename(value: string, language: string): string | null {
  let path: string; try { path = codeFilePath(value); } catch { return null; }
  const name = path.split("/").at(-1)!, lower = name.toLowerCase();
  if (["dockerfile", "makefile", ".gitignore", ".editorconfig", ".env", ".env.example"].includes(lower)) return path;
  if (language === "text" || !Object.hasOwn(fileExtensions, language)) return path;
  const extra: Record<string, string[]> = { kotlin: ["kts"], javascript: ["mjs", "cjs"], typescript: ["mts", "cts"], cpp: ["cc", "cxx", "h", "hpp", "hh"], c: ["h"], yaml: ["yaml"], xml: ["plist", "xcscheme", "storyboard", "xib"] };
  return [codeExtension(language).toLowerCase(), ...(extra[language] || [])].some(extension => lower.endsWith(`.${extension}`)) ? path : null;
}
