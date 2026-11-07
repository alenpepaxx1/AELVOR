// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { addProjectVersion, mergeProjectVersions, parseProjectVersions, projectSourceSignature, projectVersionLabel, projectVersionLimits, projectVersionsBackup, projectVersionsKey, readProjectVersions, restoreProjectVersion, validateProjectVersions, writeProjectVersions } from "../lib/project-versions.ts";

const project = (id = "one", content = "print(1)\n") => ({ id, name: "Source", slug: "source", target: "python", files: [{ path: "app/main.py", content }], createdAt: 1, updatedAt: 2 });
const version = (p = project(), id = "v1", label = "Working source") => addProjectVersion([], p, label, id, 3).versions[0];
const largeProject = (id, count, character = "x") => ({ ...project(id), files: Array.from({ length: count }, (_, i) => ({ path: `file${i}.txt`, content: character.repeat(120_000) })) });

test("saved snapshots are detached from mutable source and preserve imported notices/metadata", () => {
  const p = { ...project(), imported: true, sourceMessageId: "reply", files: [{ path: "LICENSE", content: "Upstream notice\r\n" }] };
  const v = version(p); p.files[0].content = "changed"; p.name = "Renamed";
  assert.equal(v.snapshot.files[0].content, "Upstream notice\r\n"); assert.equal(v.snapshot.name, "Source");
  assert.equal(v.snapshot.imported, true); assert.equal(v.snapshot.sourceMessageId, "reply");
  assert.deepEqual(parseProjectVersions(JSON.stringify(projectVersionsBackup([v]))), [v]);
});
test("unchanged latest source is deduplicated while source/metadata changes create versions", () => {
  const p = project(), initial = addProjectVersion([], p, "first", "v1", 3);
  const same = addProjectVersion(initial.versions, { ...p, updatedAt: 9, sourceMessageId: "later" }, "different label", "v2", 9);
  assert.equal(same.created, false); assert.equal(same.versions.length, 1);
  for (const changed of [{ ...p, name: "Renamed" }, { ...p, target: "general" }, { ...p, imported: true }, project("one", "changed")]) assert.equal(addProjectVersion(initial.versions, changed, "new", "v2", 9).created, true);
  assert.equal(projectSourceSignature({ ...p, files: [{ path: "b.py", content: "b" }, ...p.files] }), projectSourceSignature({ ...p, files: [...p.files, { path: "b.py", content: "b" }] }));
});
test("new checkpoints retain eight per project in insertion order", () => {
  let history = [];
  for (let i = 0; i < 11; i++) {
    const result = addProjectVersion(history, project("one", `source ${i}`), "checkpoint", `v${i}`, 100 - i);
    assert.equal(result.pruned, i >= 8 ? 1 : 0); history = result.versions;
  }
  assert.deepEqual(history.map(v => v.id), ["v10", "v9", "v8", "v7", "v6", "v5", "v4", "v3"]);
});
test("history enforces its global count independently of active project count", () => {
  let history = [];
  for (let i = 0; i < 27; i++) history = addProjectVersion(history, project(`p${i}`), "checkpoint", `v${i}`, i).versions;
  assert.equal(history.length, 24); assert.equal(history[0].id, "v26"); assert.equal(history.at(-1).id, "v3");
});
test("retention prunes oldest snapshots by source character budget", () => {
  const old = version(largeProject("old", 4));
  const result = addProjectVersion([old], largeProject("new", 5), "new", "v2", 4);
  assert.equal(result.pruned, 1); assert.equal(result.versions.length, 1); assert.equal(result.versions[0].projectId, "new");
});
test("serialized byte limits include escaped source and retain an exportable snapshot", () => {
  const old = version(largeProject("old", 4, "\u0001"));
  const result = addProjectVersion([old], largeProject("new", 3, "\u0001"), "new", "v2", 4);
  assert.equal(result.pruned, 1); assert.ok(new TextEncoder().encode(JSON.stringify(projectVersionsBackup(result.versions))).byteLength <= projectVersionLimits.bytes);
  assert.deepEqual(parseProjectVersions(JSON.stringify(projectVersionsBackup(result.versions))), result.versions);
});
test("history labels normalize control characters and have bounded defaults", () => {
  assert.equal(projectVersionLabel("  Before\nAI\tchange  "), "Before AI change");
  assert.equal(projectVersionLabel(" \n "), "Checkpoint"); assert.equal(projectVersionLabel("x".repeat(200)).length, 80);
});
test("invalid history IDs, times, snapshot paths and metadata are rejected", () => {
  const v = version();
  for (const bad of [{ ...v, id: "../../" }, { ...v, projectId: "other" }, { ...v, createdAt: -1 }, { ...v, createdAt: Infinity }, { ...v, label: "bad\nlabel" }, { ...v, snapshot: { ...v.snapshot, files: [{ path: "../secret", content: "x" }] } }]) assert.throws(() => validateProjectVersions([bad]));
  assert.throws(() => validateProjectVersions([v, v]), /project_versions_invalid/);
  const checked = validateProjectVersions([{ ...v, injected: true, snapshot: { ...v.snapshot, injected: true } }])[0];
  assert.equal(checked.injected, undefined); assert.equal(checked.snapshot.injected, undefined);
});
test("backups reject wrong format/version, malformed JSON and oversized input", () => {
  for (const text of ["{", "null", JSON.stringify({ format: "aelvor-code-projects", version: 1, versions: [] }), JSON.stringify({ format: "aelvor-project-versions", version: 2, versions: [] }), " ".repeat(projectVersionLimits.bytes + 1)]) assert.throws(() => parseProjectVersions(text));
});
test("corrupt or inaccessible history is reported without performing a write", () => {
  const calls = [], storage = { getItem(key) { calls.push(key); return "broken"; }, setItem() { assert.fail("read must not overwrite"); } };
  assert.deepEqual(readProjectVersions(storage), { versions: [], error: true }); assert.deepEqual(calls, [projectVersionsKey]);
  assert.deepEqual(readProjectVersions({ getItem() { throw Error("blocked"); } }), { versions: [], error: true });
  assert.deepEqual(readProjectVersions({ getItem() { return null; } }), { versions: [], error: false });
});
test("saving is truthful under quota failure and never writes invalid snapshots", () => {
  const old = JSON.stringify(projectVersionsBackup([version()])); let saved = old;
  assert.equal(writeProjectVersions([], { setItem() { throw Error("quota"); } }), false); assert.equal(saved, old);
  assert.equal(writeProjectVersions([version()], { setItem(key, text) { assert.equal(key, projectVersionsKey); saved = text; } }), true);
  assert.deepEqual(parseProjectVersions(saved), [version()]);
  assert.equal(writeProjectVersions([{ ...version(), label: "" }], { setItem() { assert.fail("invalid data written"); } }), false);
});
test("history import merges without replacing existing IDs and skips identical snapshots", () => {
  const first = version(), changed = version(project("one", "new source"));
  const result = mergeProjectVersions([first], [first, { ...changed, id: "other" }], () => "new-id");
  assert.equal(result.added, 1); assert.equal(result.skipped, 1); assert.equal(result.versions[0].id, "v1");
  const collision = mergeProjectVersions([first], [changed], () => "replacement");
  assert.equal(collision.versions[0].snapshot.files[0].content, first.snapshot.files[0].content);
  assert.equal(collision.versions[1].id, "replacement");
  assert.throws(() => mergeProjectVersions([first], [changed], () => "v1"), /project_versions_invalid/);
});
test("failed history merges are atomic when combined limits would be exceeded", () => {
  const history = Array.from({ length: 8 }, (_, i) => version(project("one", String(i)), `v${i}`));
  const original = JSON.stringify(history);
  assert.throws(() => mergeProjectVersions(history, [version(project("one", "ninth"), "v9")], () => "next"), /project_versions_limit/);
  assert.equal(JSON.stringify(history), original);
});
test("restoring replaces the full source tree, preserves project identity and leaves other projects alone", () => {
  const old = { ...project(), imported: true, files: [{ path: "old.py", content: "older\r\n" }, { path: "empty.py", content: "" }] };
  const current = { ...project("one", "current"), createdAt: 100 }, other = project("other", "untouched");
  const result = restoreProjectVersion([current, other], version(old), false, () => { assert.fail("identity should be retained"); }, 200);
  assert.equal(result.id, "one"); assert.equal(result.asCopy, false); assert.equal(result.projects[0].createdAt, 100); assert.equal(result.projects[0].updatedAt, 200);
  assert.deepEqual(result.projects[0].files, old.files); assert.equal(result.projects[0].imported, true); assert.deepEqual(result.projects[1], other);
  assert.equal(current.files[0].content, "current");
});
test("copy restore and deleted-project recovery allocate fresh IDs without replacing unrelated source", () => {
  for (const copy of [true, false]) {
    const live = copy ? [project()] : [project("other")]; let next = 0;
    const result = restoreProjectVersion(live, version(), copy, () => ["one", live[0].id, "fresh"][next++], 100);
    assert.equal(result.asCopy, true); assert.equal(result.id, "fresh"); assert.equal(result.projects.length, 2); assert.deepEqual(result.projects[0], live[0]);
    assert.equal(result.projects[1].createdAt, 100); assert.equal(result.projects[1].updatedAt, 100);
  }
});
test("restore refuses impossible copy IDs and project/combined source limits atomically", () => {
  assert.throws(() => restoreProjectVersion([], version(), true, () => "one"), /project_versions_invalid/);
  const projects = Array.from({ length: 12 }, (_, i) => project(`p${i}`)); const original = JSON.stringify(projects);
  assert.throws(() => restoreProjectVersion(projects, version(), true, () => "fresh"), /code_project_limit/); assert.equal(JSON.stringify(projects), original);
  const large = [largeProject("one", 5), largeProject("two", 5)];
  assert.throws(() => restoreProjectVersion(large, version(largeProject("third", 1)), true, () => "fresh"), /code_project_limit/);
  assert.equal(large.length, 2);
});
