// Copyright © 2026 Alen Pepa
import type { CodeFile } from "./code-projects.ts";
export type LineChange = { kind: "same" | "add" | "remove"; text: string };
export type DiffRow = LineChange & { index: number; oldLine: number | null; newLine: number | null; gapBefore: number };
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
function middleDiff(a: string[], b: string[], budget: number): LineChange[] | null {
  if (!a.length) return b.map(text => ({ kind: "add", text }));
  if (!b.length) return a.map(text => ({ kind: "remove", text }));
  const trace: Map<number, number>[] = [], current = new Map<number, number>([[1, 0]]); let work = 0;
  for (let depth = 0; depth <= Math.min(a.length + b.length, 128); depth++) {
    trace.push(new Map(current));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (++work > budget) return null;
      let x = diagonal === -depth || diagonal !== depth && (current.get(diagonal - 1) ?? -Infinity) < (current.get(diagonal + 1) ?? -Infinity) ? current.get(diagonal + 1) ?? 0 : (current.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; if (++work > budget) return null; }
      current.set(diagonal, x);
      if (x >= a.length && y >= b.length) {
        const result: LineChange[] = []; x = a.length; y = b.length;
        for (let d = trace.length - 1; d >= 0; d--) {
          const previous = trace[d], k = x - y;
          const previousK = k === -d || k !== d && (previous.get(k - 1) ?? -Infinity) < (previous.get(k + 1) ?? -Infinity) ? k + 1 : k - 1;
          const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
          while (x > previousX && y > previousY) { result.push({ kind: "same", text: a[x - 1] }); x--; y--; }
          if (!d) break;
          if (x === previousX) { result.push({ kind: "add", text: b[y - 1] }); y--; } else { result.push({ kind: "remove", text: a[x - 1] }); x--; }
        }
        return result.reverse();
      }
    }
  }
  return null;
}
export function diffCodeLines(before: string, after: string, budget = 200_000) {
  const a = lines(before), b = lines(after); let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix), middle = middleDiff(left, right, Math.max(1, Math.min(200_000, budget)));
  const operations: LineChange[] = [...a.slice(0, prefix).map(text => ({ kind: "same" as const, text })), ...(middle || [...left.map(text => ({ kind: "remove" as const, text })), ...right.map(text => ({ kind: "add" as const, text }))]), ...a.slice(a.length - suffix).map(text => ({ kind: "same" as const, text }))];
  return { operations, coarse: middle === null, added: operations.filter(row => row.kind === "add").length, removed: operations.filter(row => row.kind === "remove").length };
}
export function diffDisplayRows(operations: LineChange[], context = 3, maximum = 400) {
  const ranges: [number, number][] = [];
  operations.forEach((row, index) => { if (row.kind === "same") return; const low = Math.max(0, index - context), high = Math.min(operations.length - 1, index + context), last = ranges.at(-1); if (last && low <= last[1] + 1) last[1] = high; else ranges.push([low, high]); });
  const rows: DiffRow[] = []; let oldLine = 1, newLine = 1, range = 0, previousIndex = -1, truncated = false;
  for (let index = 0; index < operations.length; index++) {
    const row = operations[index]; while (range < ranges.length && ranges[range][1] < index) range++;
    if (range < ranges.length && index >= ranges[range][0]) {
      if (rows.length < maximum) { rows.push({ ...row, index, oldLine: row.kind === "add" ? null : oldLine, newLine: row.kind === "remove" ? null : newLine, gapBefore: index - previousIndex - 1 }); previousIndex = index; } else truncated = true;
    }
    if (row.kind !== "add") oldLine++; if (row.kind !== "remove") newLine++;
  }
  return { rows, truncated };
}
export type CodeFileChange = { path: string; before?: CodeFile; after?: CodeFile; kind: "added" | "modified" | "removed" | "same" };
export function compareCodeFiles(before: CodeFile[], after: CodeFile[]): CodeFileChange[] {
  const old = new Map(before.map(file => [file.path.toLowerCase(), file])), changes: CodeFileChange[] = [];
  for (const file of after) { const previous = old.get(file.path.toLowerCase()); old.delete(file.path.toLowerCase()); changes.push({ path: file.path, before: previous, after: file, kind: !previous ? "added" : previous.path !== file.path || previous.content !== file.content ? "modified" : "same" }); }
  for (const file of old.values()) changes.push({ path: file.path, before: file, kind: "removed" });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
