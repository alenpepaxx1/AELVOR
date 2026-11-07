// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { projectExportEnvironment, saveProjectLocally, shareProjectZip } from "../lib/project-export.ts";
import { createProjectScaffold, codeProjectGuide } from "../lib/project-scaffolds.ts";
import { importSourceProject } from "../lib/project-import.ts";
import { codeProjectFromArtifacts, codeProjectsBackup, parseCodeProjects } from "../lib/code-projects.ts";
import { extractArtifacts } from "../lib/local-tools.ts";
const project = () => createProjectScaffold("python", "Small project", "com.example.app", "one", "en", 1);

test("a failed file write reports failure even if native abort cleanup never completes", async () => {
  let downloads = 0, closes = 0, aborts = 0;
  const result = saveProjectLocally(project(), { download() { downloads++; }, pick: async () => ({ createWritable: async () => ({ write: async () => { throw Error("disk full"); }, close: async () => { closes++; }, abort: () => { aborts++; return new Promise(() => {}); } }) }) }).then(() => "unexpected-success", error => error.message);
  const observed = await Promise.race([result, new Promise(resolve => setImmediate(() => setImmediate(() => resolve("still-pending"))))]);
  assert.equal(observed, "project_export_save"); assert.equal(aborts, 1); assert.equal(closes, 0); assert.equal(downloads, 0);
});

test("a restricted share capability probe is treated as unavailable without starting a write", async () => {
  let calls = 0;
  const result = await shareProjectZip(project(), { canShare() { throw new DOMException("Restricted", "NotAllowedError"); }, share: async () => { calls++; }, download() { calls++; } });
  assert.equal(result, "unsupported"); assert.equal(calls, 0);
});

test("restricted capability getters cannot disable a different available export method", async () => {
  let downloads = 0, shares = 0, saves = 0;
  const blockedPicker = { get showSaveFilePicker() { throw Error("Restricted getter"); } };
  const shareHost = { canShare() { assert.equal(this, shareHost); return true; }, async share() { assert.equal(this, shareHost); shares++; } };
  const shareEnvironment = projectExportEnvironment(blockedPicker, shareHost, () => { downloads++; });
  assert.equal(await shareProjectZip(project(), shareEnvironment), "shared");
  assert.equal(await saveProjectLocally(project(), shareEnvironment), "download-started");
  const picker = { async showSaveFilePicker() { assert.equal(this, picker); return { createWritable: async () => ({ write: async () => {}, close: async () => { saves++; } }) }; } };
  const blockedShare = { get canShare() { throw Error("Restricted getter"); }, get share() { throw Error("Restricted getter"); } };
  const saveEnvironment = projectExportEnvironment(picker, blockedShare, () => assert.fail("No fallback needed"));
  assert.equal(await saveProjectLocally(project(), saveEnvironment), "saved");
  assert.equal(await shareProjectZip(project(), saveEnvironment), "unsupported");
  assert.deepEqual({ downloads, shares, saves }, { downloads: 1, shares: 1, saves: 1 });
});

test("a synchronous abort-cleanup error cannot turn a failed write into a reported cancellation", async () => {
  const environment = { download() { assert.fail("No automatic replay"); }, pick: async () => ({ createWritable: async () => ({ write: async () => { throw Error("disk full"); }, close: async () => assert.fail("No successful close"), abort() { throw new DOMException("Cleanup aborted", "AbortError"); } }) }) };
  await assert.rejects(saveProjectLocally(project(), environment), /project_export_save/);
});

test("BOM-prefixed JSON credentials are excluded without changing ordinary BOM-prefixed source", async () => {
  const key = "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-TEST-DATA\n-----END PRIVATE KEY-----";
  const data = [['root/account.json', '\ufeff' + JSON.stringify({ type: "service_account", private_key: key })], ['root/config.json', '\ufeff' + JSON.stringify({ enabled: true })]];
  const entries = data.map(([path, content]) => { const bytes = new TextEncoder().encode(content); return { path, size: bytes.length, read: async () => bytes }; });
  const result = await importSourceProject(entries, { name: "Imported", id: "import", stripRoot: true, now: 1 }, new AbortController().signal);
  assert.deepEqual(result.project.files, [{ path: "config.json", content: data[1][1] }]);
  assert.deepEqual(result.report.skipped, [{ path: "account.json", reason: "private" }]);
});

test("AI file imports use their actual configuration instead of assuming starter build commands", () => {
  const artifacts = extractArtifacts([{ id: "ai-reply", role: "assistant", content: '```python filename=run.py\nprint("Standalone program")\n```' }]);
  const imported = codeProjectFromArtifacts(artifacts[0], artifacts, "new", 1);
  const restored = parseCodeProjects(JSON.stringify(codeProjectsBackup([imported])))[0];
  assert.equal(restored.imported, true); assert.equal(restored.sourceMessageId, "ai-reply");
  for (const locale of ["en", "de"]) { const guide = codeProjectGuide(restored, locale); assert.deepEqual(guide.commands, []); assert.doesNotMatch(guide.note, /python -m app.main/); }
});
