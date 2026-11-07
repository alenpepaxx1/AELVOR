// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { compareCodeFiles, diffCodeLines, diffDisplayRows } from "../lib/project-diff.ts";

function reconstruct(before, after, budget) {
  const result = diffCodeLines(before, after, budget);
  assert.equal(result.operations.filter(row => row.kind !== "add").map(row => row.text).join(""), before);
  assert.equal(result.operations.filter(row => row.kind !== "remove").map(row => row.text).join(""), after);
  assert.equal(result.added, result.operations.filter(row => row.kind === "add").length);
  assert.equal(result.removed, result.operations.filter(row => row.kind === "remove").length);
  return result;
}
test("line comparison preserves exact source for empty, CRLF, blank and unterminated files", () => {
  for (const before of ["", "\n", "a\n", "a", "a\r\n\r\nlast", "😀\nö\n", "\r"]) {
    for (const after of ["", "\n", "b\n", "a", "a\r\nlast\r\n", "😀\nö", "\r"]) reconstruct(before, after);
  }
});
test("unified comparison identifies a small replacement with shared context", () => {
  const result = reconstruct("first\nold\nlast\n", "first\nnew\nlast\n");
  assert.equal(result.coarse, false);
  assert.deepEqual(result.operations.map(row => row.kind), ["same", "remove", "add", "same"]);
  assert.equal(result.added, 1); assert.equal(result.removed, 1);
});
test("bounded diff reconstructs both sides across deterministic random edits", () => {
  let seed = 28471; const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  const vocabulary = ["a\n", "b\n", "\r\n", "😀\n", "repeat\n", "ö\r\n"];
  for (let run = 0; run < 400; run++) {
    const before = Array.from({ length: random(60) }, () => vocabulary[random(vocabulary.length)]);
    const after = [...before];
    for (let edit = 0; edit < 12; edit++) after.splice(random(after.length + 1), random(4), ...Array.from({ length: random(4) }, () => vocabulary[random(vocabulary.length)]));
    reconstruct(before.join(""), after.join(""));
  }
});
test("work and edit limits fall back to a complete block replacement", () => {
  const result = reconstruct(Array.from({ length: 300 }, (_, i) => `old ${i}\n`).join(""), Array.from({ length: 300 }, (_, i) => `new ${i}\n`).join(""), 2);
  assert.equal(result.coarse, true); assert.equal(result.added, 300); assert.equal(result.removed, 300);
  const display = diffDisplayRows(result.operations); assert.equal(display.rows.length, 400); assert.equal(display.truncated, true);
});
test("display selects late-file changes with accurate original and proposed line numbers", () => {
  const source = Array.from({ length: 1500 }, (_, i) => `line ${i}\n`), after = [...source]; after[1490] = "changed\n";
  const { rows, truncated } = diffDisplayRows(reconstruct(source.join(""), after.join("")).operations);
  assert.equal(truncated, false); assert.ok(rows.length < 12); assert.ok(rows[0].gapBefore > 1400);
  assert.equal(rows.find(row => row.kind === "remove").oldLine, 1491);
  assert.equal(rows.find(row => row.kind === "add").newLine, 1491);
});
test("multiple hunks retain gaps and exact added/removed line numbering", () => {
  const { rows } = diffDisplayRows(diffCodeLines("a\nb\nc\nd\ne\nf\ng\n", "new\na\nb\nc\nd\ne\ng\n").operations, 0);
  assert.deepEqual(rows.map(row => [row.kind, row.oldLine, row.newLine]), [["add", null, 1], ["remove", 6, null]]);
  assert.equal(rows[1].gapBefore, 5);
  assert.deepEqual(diffDisplayRows(diffCodeLines("same", "same").operations), { rows: [], truncated: false });
});
test("tree comparison includes removals, case-only renames and exact empty source", () => {
  const before = [{ path: "src/App.ts", content: "" }, { path: "old.py", content: "old" }, { path: "same.py", content: "keep" }];
  const after = [{ path: "src/app.ts", content: "" }, { path: "new.py", content: "" }, { path: "same.py", content: "keep" }];
  const result = compareCodeFiles(before, after);
  assert.deepEqual(Object.fromEntries(result.map(item => [item.path, item.kind])), { "new.py": "added", "old.py": "removed", "same.py": "same", "src/app.ts": "modified" });
  assert.equal(result.find(item => item.path === "src/app.ts").before.path, "src/App.ts");
});
