// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceStorage, workspaceStorageKey } from "../lib/workspace-storage.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";
import { createConversationBackup, mergeConversationBackup } from "../lib/conversation-workspace.ts";
import { loadComponent } from "./support/render-component.mjs";

const empty = () => restoreWorkspace(null);
const snapshot = { chats: [{ id: "saved", title: "Keep me", updatedAt: 1, messages: [{ id: "u", role: "user", content: "Hallo" }] }], activeId: "saved", locale: "de", theme: "light" };
function fixture(raw = null) {
  const entries = new Map(raw === null ? [] : [[workspaceStorageKey, raw]]);
  let writes = 0;
  const host = { getItem: key => entries.get(key) ?? null, setItem(key, value) { writes++; entries.set(key, value); } };
  return { entries, host, store: new WorkspaceStorage(() => host), writes: () => writes };
}

test("storage cannot write before reading; a missing snapshot permits a first save", () => {
  const f = fixture();
  assert.equal(f.store.save(empty()), false); assert.equal(f.writes(), 0);
  assert.equal(f.store.read().issue, null); assert.equal(f.store.writable, true);
  assert.equal(f.store.save(empty()), true); assert.equal(f.writes(), 1);
  assert.deepEqual(JSON.parse(f.entries.get(workspaceStorageKey)).chats, []);
});

test("an unreadable snapshot remains byte for byte intact across repeated autosave attempts", () => {
  const raw = '{"chats":[{"id":"important"}';
  const f = fixture(raw), result = f.store.read();
  assert.deepEqual(result, { data: null, issue: { kind: "invalid", raw } });
  for (let i = 0; i < 5; i++) assert.equal(f.store.save(empty()), false);
  assert.equal(f.entries.get(workspaceStorageKey), raw); assert.equal(f.writes(), 0);
  assert.equal(f.store.writable, false);
});

test("valid JSON with an invalid workspace container is protected rather than saved as an empty history", () => {
  for (const raw of ['null', '[]', 'false', '42', '"legacy?"', '{"chats":{}}', '{"chats":null}', '{"projects":"wrong"}', '']) {
    const f = fixture(raw), result = f.store.read();
    assert.equal(result.issue.kind, "invalid", raw); assert.equal(result.issue.raw, raw);
    assert.equal(f.store.save(empty()), false); assert.equal(f.entries.get(workspaceStorageKey), raw);
  }
});

test("legacy preference-only records and repaired interrupted replies still load and save", () => {
  const f = fixture(JSON.stringify({ locale: "de", collapsed: true }));
  assert.equal(f.store.read().data.locale, "de"); assert.equal(f.store.save(empty()), true);
  const pending = structuredClone(snapshot); pending.chats[0].messages.push({ id: "p", role: "assistant", content: "Teilweise", pending: true });
  const restored = fixture(JSON.stringify(pending)); const result = restored.store.read();
  assert.equal(result.issue, null); assert.equal(result.data.chats[0].messages[1].stopped, true);
  assert.equal(result.data.activeId, "saved"); assert.equal(result.data.theme, "light");
  assert.equal(restored.store.save(result.data), true);
});

test("a denied storage read stays protected even if access later returns, until an explicit successful read", () => {
  const f = fixture(JSON.stringify(snapshot)); let denied = true;
  const store = new WorkspaceStorage(() => { if (denied) throw Error("Storage denied"); return f.host; });
  assert.deepEqual(store.read(), { data: null, issue: { kind: "unavailable", raw: null } });
  denied = false; assert.equal(store.save(empty()), false); assert.equal(f.writes(), 0);
  assert.equal(store.read().data.chats[0].title, "Keep me"); assert.equal(store.writable, true);
});

test("a throwing getItem also prevents a later successful setItem from overwriting hidden history", () => {
  const f = fixture(JSON.stringify(snapshot));
  const store = new WorkspaceStorage(() => ({ ...f.host, getItem() { throw Error("Temporary read failure"); } }));
  assert.equal(store.read().issue.kind, "unavailable"); assert.equal(store.save(empty()), false);
  assert.equal(f.writes(), 0); assert.equal(f.entries.get(workspaceStorageKey), JSON.stringify(snapshot));
});

test("backup imports use the same guarded save and cannot replace an unreadable saved workspace", () => {
  const f = fixture("broken saved data"); f.store.read();
  const backup = createConversationBackup(snapshot.chats);
  let sequence = 0;
  const merged = mergeConversationBackup([], backup, () => `import-${++sequence}`);
  assert.equal(f.store.save({ ...empty(), chats: merged.chats, projects: merged.projects }), false);
  assert.equal(f.entries.get(workspaceStorageKey), "broken saved data"); assert.equal(f.writes(), 0);
});

test("failed recovery preserves the original data and cannot reenable automatic saving", () => {
  const f = fixture("broken saved data"); let full = true;
  const store = new WorkspaceStorage(() => ({ ...f.host, setItem(key, value) { if (full) throw Error("QuotaExceededError"); f.host.setItem(key, value); } }));
  const issue = store.read().issue;
  assert.equal(store.replace(empty()), false); assert.equal(store.writable, false);
  assert.equal(issue.raw, "broken saved data"); assert.equal(f.entries.get(workspaceStorageKey), issue.raw);
  full = false; assert.equal(store.save(empty()), false); assert.equal(f.writes(), 0);
  assert.equal(store.replace(restoreWorkspace(snapshot)), true); assert.equal(store.writable, true);
  assert.equal(JSON.parse(f.entries.get(workspaceStorageKey)).chats[0].title, "Keep me");
  assert.equal(store.save({ ...empty(), locale: "de" }), true);
});

test("ordinary save quota errors report failure without modifying the previous snapshot", () => {
  const raw = JSON.stringify(snapshot), f = fixture(raw);
  const store = new WorkspaceStorage(() => ({ ...f.host, setItem() { throw Error("QuotaExceededError"); } }));
  assert.equal(store.read().issue, null); assert.equal(store.save(empty()), false);
  assert.equal(f.entries.get(workspaceStorageKey), raw);
});

test("the recovery screen explains paused saving and exposes the original-data export in English and German", async () => {
  const Recovery = await loadComponent(new URL("../app/workspace-recovery.tsx", import.meta.url));
  for (const locale of ["en", "de"]) {
    const html = renderToStaticMarkup(createElement(Recovery, { issue: { kind: "invalid", raw: "broken" }, locale, busy: false, onDownload() {}, onReplace() { return false; } }));
    assert.match(html, /aria-labelledby="workspace-recovery-title"/);
    assert.match(html, locale === "de" ? /pausiert/ : /paused/);
    assert.match(html, locale === "de" ? /Originaldaten herunterladen/ : /Download original data/);
    assert.doesNotMatch(html, /disabled/);
  }
  const denied = renderToStaticMarkup(createElement(Recovery, { issue: { kind: "unavailable", raw: null }, locale: "en", busy: true, onDownload() {}, onReplace() { return false; } }));
  assert.match(denied, /Enable storage/); assert.equal((denied.match(/disabled=""/g) || []).length, 2);
});
