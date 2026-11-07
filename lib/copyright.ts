// Copyright © 2026 Alen Pepa
import { COPYRIGHT_NOTICE } from "./brand.ts";
import { codeFences } from "./code-fences.ts";
import { codeLanguage } from "./code-files.ts";

const hash = new Set("python py bash sh shell zsh fish powershell ps1 ruby rb perl pl r yaml yml toml dockerfile makefile make conf ini properties cmake elixir julia nim".split(" "));
const slash = new Set("javascript js jsx typescript ts tsx java go rust rs swift kotlin kt dart scala csharp cs c# protobuf solidity zig".split(" "));
const block = new Set("css scss sass less c cpp c++ objective-c objc php".split(" "));
const dash = new Set("sql lua haskell hs".split(" "));
const markup = new Set("html xml svg markdown md".split(" "));

export function attributeCode(code: string, language: string): string {
  const key = language.trim().toLowerCase().split(/\s+/, 1)[0];
  const notice = hash.has(key) ? `# ${COPYRIGHT_NOTICE}` : slash.has(key) ? `// ${COPYRIGHT_NOTICE}` : block.has(key) ? `/* ${COPYRIGHT_NOTICE} */` : dash.has(key) ? `-- ${COPYRIGHT_NOTICE}` : markup.has(key) ? `<!-- ${COPYRIGHT_NOTICE} -->` : key === "erlang" ? `% ${COPYRIGHT_NOTICE}` : key === "bat" || key === "batch" || key === "cmd" ? `REM ${COPYRIGHT_NOTICE}` : "";
  // Strict data formats (JSON, hashes, CSV, plain text) must stay byte-for-byte
  // usable as data. Their surrounding app UI and exported documents carry notice.
  if (!notice || !code.trim()) return code;
  const beginning = code.split(/\r?\n/).slice(0, 10);
  if (beginning.some(line => /^\s*(?:#|\/\/|\/\*|\*|<!--|--|%|REM\b).*Copyright\s*(?:©|\(c\))?\s*2026\s+Alen Pepa/i.test(line))) return code;
  if (key === "php" && /^<\?php\b/.test(code)) return code.replace(/^<\?php\b\s*/, `<?php\n${notice}\n`);
  let offset = 0;
  const lines = code.split("\n");
  if (lines[0].startsWith("#!") || /^<\?xml\b/.test(lines[0]) || /^@charset\s/i.test(lines[0]) || /^\s*["']use (?:client|server|strict)["'];?\s*$/.test(lines[0])) offset = lines[0].length + (lines.length > 1 ? 1 : 0);
  if ((key === "python" || key === "py") && /^#.*coding[:=]/.test(lines[offset ? 1 : 0] || "")) offset += lines[offset ? 1 : 0].length + 1;
  const prefix = code.slice(0, offset), rest = code.slice(offset);
  return `${prefix}${prefix && !prefix.endsWith("\n") ? "\n" : ""}${notice}\n${rest}`;
}

export function attributeMarkdown(text: string): string {
  let cursor = 0, result = "";
  for (const fence of codeFences(text)) { result += text.slice(cursor, fence.codeStart) + attributeCode(fence.code, codeLanguage(fence.info)) + text.slice(fence.codeEnd, fence.end); cursor = fence.end; }
  return result + text.slice(cursor);
}
