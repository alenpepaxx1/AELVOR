// Copyright © 2026 Alen Pepa
import type { CodeProject } from "./code-projects.ts";
export type CodeSearchHit = { path: string; line: number; column: number; offset: number; length: number; value: string; before: string; match: string; after: string };
const word = (value: string) => /[\p{L}\p{M}\p{N}_]/u.test(value);
export function searchProjectCode(project: CodeProject, query: string, options: { caseSensitive?: boolean; wholeWord?: boolean; maximum?: number } = {}) {
  const hits: CodeSearchHit[] = [], maximum = Math.max(1, Math.min(200, Math.floor(options.maximum || 120)));
  if (!query || query.length > 160) return { hits, truncated: false };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "gu" : "giu");
  for (const file of project.files) {
    const starts = [0]; for (let i = 0; i < file.content.length; i++) if (file.content[i] === "\n") starts.push(i + 1);
    expression.lastIndex = 0; let found: RegExpExecArray | null;
    while ((found = expression.exec(file.content))) {
      const offset = found.index, end = offset + found[0].length;
      if (options.wholeWord && (word(file.content.slice(Math.max(0, offset - 2), offset).match(/.$/u)?.[0] || "") || word(file.content.slice(end, end + 2).match(/^./u)?.[0] || ""))) continue;
      if (hits.length >= maximum) return { hits, truncated: true };
      let low = 0, high = starts.length - 1;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (starts[middle] <= offset) low = middle; else high = middle - 1; }
      const startLine = starts[low], next = file.content.indexOf("\n", offset), endLine = next < 0 ? file.content.length : next;
      const left = Math.max(startLine, offset - Math.max(20, Math.floor((240 - found[0].length) / 2))), right = Math.min(endLine, left + 240), visibleEnd = Math.min(end, right);
      hits.push({ path: file.path, line: low + 1, column: offset - startLine + 1, offset, length: found[0].length, value: found[0], before: (left > startLine ? "…" : "") + file.content.slice(left, offset), match: file.content.slice(offset, visibleEnd), after: file.content.slice(visibleEnd, right).replace(/\r$/, "") + (right < endLine ? "…" : "") });
    }
  }
  return { hits, truncated: false };
}
