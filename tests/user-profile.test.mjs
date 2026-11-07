// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { profileStorageKey, readUserProfile, saveUserProfile, usernameInitials, usernameIssue, validUsername } from "../lib/user-profile.ts";

test("first visit asks for a name, subsequent visits restore it, and profile edits preserve conversation data", () => {
  const entries = new Map([["aegis-workspace-v1", "existing conversations"], ["aegis-local-model-v2", "existing model"]]);
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  assert.equal(readUserProfile(storage), null);
  const chosen = saveUserProfile("  Alen.Pepa  ", storage);
  assert.equal(chosen.persisted, true); assert.equal(chosen.profile.username, "Alen.Pepa");
  assert.deepEqual(readUserProfile(storage), { version: 1, username: "Alen.Pepa" });
  saveUserProfile("night_user", storage);
  assert.equal(readUserProfile(storage).username, "night_user");
  assert.equal(entries.get("aegis-workspace-v1"), "existing conversations");
  assert.equal(entries.get("aegis-local-model-v2"), "existing model");
  assert.ok(entries.has(profileStorageKey));
});

test("username validation preserves chosen casing and supports normalized German names", () => {
  for (const name of ["Alen", "jörg_24", "Müller.dev", "0xAlen", "nox-user", "ab", "a".repeat(24)]) assert.equal(validUsername(name), name);
  assert.equal(validUsername("  Jo\u0308rg  "), "Jörg");
  assert.equal(usernameIssue(""), "required");
  assert.equal(usernameIssue("a"), "length");
  assert.equal(usernameIssue("a".repeat(25)), "length");
});

test("markup, invisible controls, unsupported punctuation and non-string names cannot be persisted", () => {
  let writes = 0;
  for (const value of ["<script>alert(1)</script>", "hello world", "user\nname", "a\u200Bb", "@alen", ".alen", "alen/name", "alen🙂"]) {
    assert.equal(validUsername(value), null);
    assert.throws(() => saveUserProfile(value, { setItem() { writes++; } }), /invalid_username/);
  }
  for (const value of [null, {}, 42, ["alen"]]) assert.equal(validUsername(value), null);
  assert.equal(writes, 0);
});

test("malformed, oversized and unsupported stored profiles return to onboarding without breaking startup", () => {
  for (const raw of [null, "broken{", "null", "[]", JSON.stringify({ version: 2, username: "Alen" }), JSON.stringify({ version: 1, username: {} }), JSON.stringify({ version: 1, username: "bad name" }), " ".repeat(4097)]) {
    assert.equal(readUserProfile({ getItem: () => raw }), null);
  }
  assert.equal(readUserProfile({ getItem() { throw new Error("Storage denied"); } }), null);
});

test("unavailable storage permits a session profile and reports that it did not persist", () => {
  const result = saveUserProfile("Alen", { setItem() { throw new DOMException("Quota reached", "QuotaExceededError"); } });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.profile, { version: 1, username: "Alen" });
});

test("retrying the same session username persists it once storage recovers", () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const session = saveUserProfile("Jörg.dev", { setItem() { throw Error("Storage denied"); } });
  assert.equal(session.persisted, false); assert.equal(readUserProfile(storage), null);
  const retried = saveUserProfile(session.profile.username, storage);
  assert.equal(retried.persisted, true); assert.equal(readUserProfile(storage).username, session.profile.username);
});

test("profile initials follow the chosen handle rather than a fixed author identity", () => {
  assert.equal(usernameInitials("Alen.Pepa"), "AP");
  assert.equal(usernameInitials("night_user"), "NU");
  assert.equal(usernameInitials("jörg"), "JÖ");
  assert.equal(usernameInitials("noir"), "NO");
  assert.equal(usernameInitials(""), "U");
});
