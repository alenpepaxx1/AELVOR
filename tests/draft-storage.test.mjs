// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftAutosave, DraftStorage, draftsStorageKey, readDraftState, updateDraft } from "../lib/drafts.ts";
import { WorkspaceStorage, workspaceStorageKey } from "../lib/workspace-storage.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";
import { loadComponent } from "./support/render-component.mjs";

const draft = () => updateDraft([], "chat", { text: "Nächste Frage 🔐", attachments: [{ id: "file", name: "review.ts", content: "const answer = 42;", truncated: false }], mode: "investigate", engine: "chat" }, 1);
const serialize = drafts => JSON.stringify({ version: 1, drafts });
function fixture(raw = null) {
  const entries = new Map(raw === null ? [] : [[draftsStorageKey, raw]]);
  let writes = 0;
  const host = { getItem: key => entries.get(key) ?? null, setItem(key, value) { writes++; entries.set(key, value); } };
  return { entries, host, store: new DraftStorage(() => host), writes: () => writes };
}

test("a first draft saves only after storage was successfully read", () => {
  const f = fixture();
  assert.equal(f.store.save(draft()), false); assert.equal(f.writes(), 0);
  assert.deepEqual(f.store.read(new Set()), { drafts: [], issue: null });
  assert.equal(f.store.save(draft()), true);
  assert.equal(f.store.read(new Set(["chat"])).drafts[0].text, "Nächste Frage 🔐");
});

test("corrupt draft data survives automatic and lifecycle save attempts without modification", () => {
  const raw = '{"version":1,"drafts":[{"text":"Do not lose this';
  const f = fixture(raw), result = f.store.read(new Set());
  assert.deepEqual(result, { drafts: [], issue: { kind: "invalid", raw } });
  const autosave = new DraftAutosave(), save = autosave.createSave(() => f.store.save([]));
  save(); save(); save();
  assert.equal(f.writes(), 0); assert.equal(f.entries.get(draftsStorageKey), raw);
});

test("unsupported versions, invalid containers and oversized draft data are protected", () => {
  for (const raw of ["", "null", "[]", "true", "42", '{"version":2,"drafts":[]}', '{"version":1,"drafts":{}}', "x".repeat(3_000_001)]) {
    const f = fixture(raw), result = f.store.read(new Set());
    assert.equal(result.issue.kind, "invalid"); assert.equal(result.issue.raw, raw);
    assert.equal(f.store.save([]), false); assert.equal(f.writes(), 0);
    assert.equal(f.entries.get(draftsStorageKey), raw);
  }
});

test("an inaccessible storage getter cannot turn hidden drafts into an empty successful save", () => {
  const f = fixture(serialize(draft())); let denied = true;
  const store = new DraftStorage(() => { if (denied) throw Error("Access denied"); return f.host; });
  assert.deepEqual(store.read(new Set(["chat"])), { drafts: [], issue: { kind: "unavailable", raw: null } });
  denied = false; assert.equal(store.save([]), false); assert.equal(f.writes(), 0);
  const loaded = store.read(new Set(["chat"]));
  assert.deepEqual(loaded.drafts, draft()); assert.equal(store.save(loaded.drafts), true);
});

test("a failed getItem pauses draft writes even when setItem is available", () => {
  const f = fixture(serialize(draft()));
  const store = new DraftStorage(() => ({ ...f.host, getItem() { throw Error("Read blocked"); } }));
  assert.equal(store.read(new Set(["chat"])).issue.kind, "unavailable");
  assert.equal(store.save([]), false); assert.equal(f.writes(), 0);
  assert.deepEqual(JSON.parse(f.entries.get(draftsStorageKey)).drafts, draft());
});

test("valid drafts keep files and modes while malformed neighbors and orphaned chat references are filtered", () => {
  const original = draft();
  const f = fixture(serialize([null, ...original, { ...original[0], chatId: "missing" }, { ...original[0], chatId: null, text: "New question" }]));
  const result = f.store.read(new Set(["chat"]));
  assert.equal(result.issue, null); assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.drafts[0], original[0]); assert.equal(result.drafts[1].chatId, null);
  assert.equal(f.store.save(result.drafts), true);
});

test("a failed confirmed replacement preserves originals and cannot enable later automatic writes", () => {
  const f = fixture("original broken text"); let full = true;
  const store = new DraftStorage(() => ({ ...f.host, setItem(key, value) { if (full) throw Error("Storage full"); f.host.setItem(key, value); } }));
  const loaded = store.read(new Set(["chat"]));
  assert.equal(store.replace(draft()), false); assert.equal(store.writable, false);
  assert.equal(f.entries.get(draftsStorageKey), loaded.issue.raw);
  full = false; assert.equal(store.save([]), false); assert.equal(f.writes(), 0);
  assert.equal(store.replace(draft()), true); assert.equal(store.writable, true);
  assert.deepEqual(store.read(new Set(["chat"])).drafts, draft());
});

test("failed or oversized ordinary writes leave the last saved draft intact and allow a valid retry", () => {
  const raw = serialize(draft()), f = fixture(raw); let full = true;
  const store = new DraftStorage(() => ({ ...f.host, setItem(key, value) { if (full) throw Error("Storage full"); f.host.setItem(key, value); } }));
  store.read(new Set(["chat"])); assert.equal(store.save([]), false);
  full = false; assert.equal(store.save([{ ...draft()[0], text: "x".repeat(3_000_001) }]), false);
  assert.equal(f.entries.get(draftsStorageKey), raw);
  assert.equal(store.save([]), true); assert.deepEqual(JSON.parse(f.entries.get(draftsStorageKey)).drafts, []);
});

test("conversation saving continues independently while an unreadable draft store stays untouched", () => {
  const f = fixture("broken drafts"), workspace = new WorkspaceStorage(() => f.host);
  assert.equal(workspace.read().issue, null); assert.equal(f.store.read(new Set()).issue.kind, "invalid");
  assert.equal(workspace.save({ ...restoreWorkspace(null), locale: "de" }), true);
  assert.equal(f.store.save([]), false);
  assert.equal(JSON.parse(f.entries.get(workspaceStorageKey)).locale, "de");
  assert.equal(f.entries.get(draftsStorageKey), "broken drafts");
});

test("a callback captured before a later read failure respects the current draft write guard", () => {
  const f = fixture(serialize(draft())); f.store.read(new Set(["chat"]));
  const save = new DraftAutosave().createSave(() => f.store.save([]));
  f.entries.set(draftsStorageKey, "new unreadable data"); f.store.read(new Set(["chat"]));
  save(); assert.equal(f.writes(), 0); assert.equal(f.entries.get(draftsStorageKey), "new unreadable data");
});

test("the storage failure banner stays visible with retry and export actions in both languages", async () => {
  const Warning = await loadComponent(new URL("../app/workspace-recovery.tsx", import.meta.url), "SavingWarning");
  for (const locale of ["en", "de"]) {
    const props = { locale, issue: false, draftsIssue: false, failed: true, onOpen() {}, onRetry() {} };
    const html = renderToStaticMarkup(createElement(Warning, props));
    assert.match(html, /role="status"/);
    assert.match(html, locale === "de" ? /Speichern wiederholen/ : /Retry saving/);
    assert.match(html, locale === "de" ? /Export öffnen/ : /settings &amp; export/);
    const paused = renderToStaticMarkup(createElement(Warning, { ...props, draftsIssue: true }));
    assert.match(paused, locale === "de" ? /Ungesendet|ungesendet/ : /unsent text/);
    assert.doesNotMatch(paused, /Retry saving|Speichern wiederholen/);
    assert.equal(renderToStaticMarkup(createElement(Warning, { ...props, failed: false })), "");
  }
});

test("draft recovery explains its limited scope and protects unavailable original-data downloads", async () => {
  const Recovery = await loadComponent(new URL("../app/workspace-recovery.tsx", import.meta.url));
  for (const locale of ["en", "de"]) {
    const html = renderToStaticMarkup(createElement(Recovery, { target: "drafts", locale, busy: false, issue: { kind: "unavailable", raw: null }, onDownload() {}, onReplace() { return false; } }));
    assert.match(html, /aria-labelledby="drafts-recovery-title"/);
    assert.match(html, locale === "de" ? /Gesprächsverlauf kann weiterhin gespeichert/ : /Conversation history can still be saved/);
    assert.equal((html.match(/disabled=""/g) || []).length, 1);
    assert.match(html, locale === "de" ? /Gespeicherte Entwürfe ersetzen/ : /Replace saved drafts/);
  }
});

test("reading absent and invalid draft stores produces distinct recovery results", () => {
  assert.deepEqual(readDraftState(new Set(), { getItem: () => null }), { drafts: [], issue: null });
  const invalid = readDraftState(new Set(), { getItem: () => "{" });
  assert.deepEqual(invalid, { drafts: [], issue: { kind: "invalid", raw: "{" } });
});
