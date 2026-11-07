// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { searchProjectCode } from "../lib/project-search.ts";
const project = files => ({ id: "one", name: "Source", slug: "source", target: "general", createdAt: 1, updatedAt: 1, files });
test("code search treats regex metacharacters as literal source", () => {
  const source = "[a-z]+ (a.*) $& ? \\ end";
  for (const query of ["[a-z]+", "(a.*)", "$&", "?", "\\"]) {
    const result = searchProjectCode(project([{ path: "main.py", content: source }]), query);
    assert.equal(result.hits.length, 1); assert.equal(result.hits[0].value, query);
  }
});
test("case matching supports English and German without changing source values", () => {
  const p = project([{ path: "main.py", content: "Größe größe GRÖSSE\nHELLO hello" }]);
  assert.deepEqual(searchProjectCode(p, "größe").hits.map(hit => hit.value), ["Größe", "größe"]);
  assert.deepEqual(searchProjectCode(p, "größe", { caseSensitive: true }).hits.map(hit => hit.value), ["größe"]);
  assert.equal(searchProjectCode(p, "hello").hits.length, 2);
});
test("Unicode whole words exclude letters, numbers, underscores and combining marks", () => {
  const p = project([{ path: "main.py", content: "foo foo_bar barfoo foo2 éfoo fooé foo\u0301 🧠foo! foo😀" }]);
  const hits = searchProjectCode(p, "foo", { wholeWord: true }).hits;
  assert.equal(hits.length, 3); assert.deepEqual(hits.map(hit => hit.offset), [0, p.files[0].content.indexOf("🧠foo") + 2, p.files[0].content.lastIndexOf("foo")]);
});
test("file/line/column and UTF-16 offsets identify exactly the selected editor text", () => {
  const p = project([{ path: "first.ts", content: "😀x\r\nline needle needle\r\nlast" }, { path: "second.ts", content: "needle" }]);
  const hits = searchProjectCode(p, "needle").hits;
  assert.deepEqual(hits.map(hit => [hit.path, hit.line, hit.column]), [["first.ts", 2, 6], ["first.ts", 2, 13], ["second.ts", 1, 1]]);
  for (const hit of hits) assert.equal(p.files.find(file => file.path === hit.path).content.slice(hit.offset, hit.offset + hit.length), hit.value);
  assert.equal(searchProjectCode(p, "x").hits[0].column, 3);
});
test("search reports truncation only when an additional accepted result exists", () => {
  const p = project([{ path: "a.ts", content: "x x x" }]);
  assert.equal(searchProjectCode(p, "x", { maximum: 3 }).truncated, false);
  assert.deepEqual(searchProjectCode(p, "x", { maximum: 2 }).hits.map(hit => hit.offset), [0, 2]);
  assert.equal(searchProjectCode(p, "x", { maximum: 2 }).truncated, true);
  const many = searchProjectCode(project([{ path: "a.ts", content: "x ".repeat(500) }]), "x", { maximum: 1000 });
  assert.equal(many.hits.length, 200); assert.equal(many.truncated, true);
});
test("search bounds displayed context and preserves late-file offsets", () => {
  const p = project([{ path: "long.ts", content: "a".repeat(60_000) + "needle" + "b".repeat(59_000) }]);
  const hit = searchProjectCode(p, "needle").hits[0];
  assert.equal(hit.offset, 60_000); assert.equal(hit.column, 60_001);
  assert.ok(hit.before.startsWith("…")); assert.ok(hit.after.endsWith("…"));
  assert.ok(hit.before.length + hit.match.length + hit.after.length <= 242);
});
test("empty and oversized searches produce no matches", () => {
  const p = project([{ path: "a.ts", content: "a".repeat(200) }]);
  assert.deepEqual(searchProjectCode(p, ""), { hits: [], truncated: false });
  assert.deepEqual(searchProjectCode(p, "a".repeat(161)), { hits: [], truncated: false });
});
