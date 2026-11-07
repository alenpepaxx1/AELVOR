// Copyright © 2026 Alen Pepa
export type CodeFence = { info: string; code: string; start: number; codeStart: number; codeEnd: number; end: number; closed: boolean };
// Line-delimited fences allow README files to contain shorter nested fences.
// Source offsets are retained so attribution never rewrites unrelated prose.
export function codeFences(text: string): CodeFence[] {
  const result: CodeFence[] = [], opening = /(^|\n)[ \t]{0,3}(`{3,})([^\n`]*)\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    const start = match.index + match[1].length, codeStart = opening.lastIndex;
    const closing = new RegExp("^[ \\t]{0,3}`{" + match[2].length + ",}[ \\t]*(?:\\r?\\n|$)", "gm");
    closing.lastIndex = codeStart; const close = closing.exec(text), codeEnd = close?.index ?? text.length, end = close ? close.index + close[0].length : text.length;
    result.push({ info: match[3].trim(), code: text.slice(codeStart, codeEnd), start, codeStart, codeEnd, end, closed: Boolean(close) });
    // Retain the closing line's newline as the next opening fence's anchor.
    opening.lastIndex = close && text[end - 1] === "\n" ? end - 1 : end; if (!close) break;
  }
  return result;
}
