// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { saveUserProfile, readUserProfile, profileStorageKey } from "../lib/user-profile.ts";
import { finishFirstRun, requireFirstRunChoice, selectFirstRunEngine } from "../lib/first-run.ts";
import { conversationSettingsKey, readConversationSettings, normalizeConversationSettings } from "../lib/conversation-settings.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { defaultConversationModel } from "../lib/conversation.ts";
import { defaultCpuModel } from "../lib/cpu-models.ts";
import { defaultPhoneGpuModel } from "../lib/mobile-models.ts";
import { playbookRequest } from "../lib/templates.ts";
import { runLocalAgent } from "../lib/local-agent.ts";

const defaults = () => normalizeConversationSettings(null);
const memory = () => {
  const entries = new Map([["aegis-workspace-v1", "existing chats"], ["aelvor-drafts-v1", "existing draft"], ["aegis-local-model-v2", "existing classifier"]]), writes = [];
  return { entries, writes, getItem(key) { return entries.get(key) ?? null; }, setItem(key, value) { writes.push(key); entries.set(key, value); } };
};
const fixtureSession = () => {
  let disposed = 0, loads = 0;
  const session = new ConversationSession({ load: async modelId => { loads++; return { modelId, dispose() { disposed++; }, adapter: { interrupt() {}, async stream() { assert.fail("No generation requested during setup"); } } }; } });
  return { session, get disposed() { return disposed; }, get loads() { return loads; } };
};

test("saving the first username resumes the model step after reload while legacy profiles stay complete", () => {
  const storage = memory();
  saveUserProfile("Alen", storage, { setupPending: true });
  assert.equal(readUserProfile(storage).setupPending, true);
  saveUserProfile("Alen.Pepa", storage, { setupPending: true });
  assert.equal(readUserProfile(storage).setupPending, true); assert.equal(readUserProfile(storage).username, "Alen.Pepa");
  saveUserProfile("Legacy", storage);
  assert.deepEqual(readUserProfile(storage), { version: 1, username: "Legacy" });
  storage.setItem(profileStorageKey, JSON.stringify({ version: 1, username: "Alen", setupPending: "broken" }));
  assert.equal(readUserProfile(storage).setupPending, true);
});

test("the built-in local path completes without downloading or loading a language model and preserves user data", async () => {
  const storage = memory(), runtime = fixtureSession();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("The built-in path must not contact an AI service");
  try {
    saveUserProfile("Alen", storage, { setupPending: true });
    const result = finishFirstRun("Alen", { engine: "tools", modelId: defaultConversationModel }, runtime.session, defaults(), storage);
    assert.equal(result.persisted, true); assert.equal(readUserProfile(storage).setupPending, undefined);
    assert.equal(readConversationSettings(storage).engine, "tools"); assert.equal(runtime.loads, 0);
    const request = playbookRequest("script", "en");
    const answer = await runLocalAgent({ text: request.text, locale: "en", mode: request.mode });
    assert.match(answer.text, /Alen Pepa/);
    assert.equal(storage.entries.get("aegis-workspace-v1"), "existing chats");
    assert.equal(storage.entries.get("aelvor-drafts-v1"), "existing draft");
    assert.equal(storage.entries.get("aegis-local-model-v2"), "existing classifier");
  } finally { globalThis.fetch = savedFetch; runtime.session.unload(); }
});

test("a chat choice cannot finish on an untested, failed or different loaded model", async () => {
  const storage = memory(), runtime = fixtureSession();
  try {
    for (const state of [{ status: "idle", modelId: null }, { status: "error", modelId: defaultConversationModel }, { status: "ready", modelId: defaultCpuModel }]) assert.throws(() => requireFirstRunChoice({ engine: "chat", modelId: defaultConversationModel }, state), /setup_model_not_ready/);
    await runtime.session.load(defaultCpuModel);
    assert.throws(() => finishFirstRun("Alen", { engine: "chat", modelId: defaultConversationModel }, runtime.session, defaults(), storage), /setup_model_not_ready/);
    assert.equal(storage.writes.length, 0); assert.equal(runtime.session.ready, true);
  } finally { runtime.session.unload(); }
});

test("a matching tested CPU model completes and preserves explicit CPU choice, NVIDIA preference and budgets", async () => {
  const storage = memory(), runtime = fixtureSession();
  const previous = normalizeConversationSettings({ ...defaults(), hardwareBudget: { ramGB: 16, gpuGB: 8 }, gpuPreference: "nvidia", pausePhoneInBackground: false });
  try {
    await runtime.session.load(defaultCpuModel);
    const result = finishFirstRun("Jörg.dev", { engine: "chat", modelId: defaultCpuModel }, runtime.session, previous, storage);
    assert.equal(result.persisted, true); assert.equal(runtime.session.ready, true); assert.equal(runtime.disposed, 0);
    const restored = readConversationSettings(storage);
    assert.equal(restored.modelId, defaultCpuModel); assert.equal(restored.cpuExplicitChoice, true);
    assert.equal(restored.gpuPreference, "nvidia"); assert.deepEqual(restored.hardwareBudget, { ramGB: 16, gpuGB: 8 });
    assert.equal(restored.pausePhoneInBackground, false);
    assert.deepEqual(storage.writes, [conversationSettingsKey, profileStorageKey]);
  } finally { runtime.session.unload(); }
});

test("Load later saves the selected model and releases a previously loaded different model", async () => {
  const storage = memory(), runtime = fixtureSession();
  try {
    await runtime.session.load(defaultConversationModel);
    finishFirstRun("Alen", { engine: "chat", modelId: defaultCpuModel, loadLater: true }, runtime.session, defaults(), storage);
    assert.equal(runtime.session.ready, false); assert.equal(runtime.disposed, 1); assert.equal(runtime.loads, 1);
    assert.equal(readConversationSettings(storage).modelId, defaultCpuModel);
    assert.equal(readConversationSettings(storage).cpuExplicitChoice, true);
  } finally { runtime.session.unload(); }
});

test("switching from a loaded model to the built-in path releases the language-model worker", async () => {
  const storage = memory(), runtime = fixtureSession();
  await runtime.session.load(defaultConversationModel);
  finishFirstRun("Alen", { engine: "tools", modelId: defaultConversationModel }, runtime.session, defaults(), storage);
  assert.equal(runtime.session.ready, false); assert.equal(runtime.disposed, 1);
});

test("choosing the built-in assistant cancels an unfinished load and ignores a late runtime", async () => {
  let resolveLoad, disposed = 0;
  const session = new ConversationSession({ load: async modelId => new Promise(resolve => { resolveLoad = () => resolve({ modelId, dispose() { disposed++; }, adapter: { interrupt() {}, stream() { assert.fail("No generation during setup"); } } }); }) });
  const pending = session.load(defaultConversationModel);
  assert.equal(session.getSnapshot().status, "loading");
  assert.equal(selectFirstRunEngine("tools", session), "tools");
  await assert.rejects(pending, error => error.name === "AbortError");
  const storage = memory();
  finishFirstRun("Alen", { engine: "tools", modelId: defaultConversationModel }, session, defaults(), storage);
  resolveLoad(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.ready, false); assert.equal(disposed, 1); assert.equal(readConversationSettings(storage).engine, "tools");
  session.unload();
});

test("failed settings or profile writes cannot persist a falsely completed setup, and the same choice can be retried", () => {
  for (const failKey of [conversationSettingsKey, profileStorageKey]) {
    const storage = memory(), runtime = fixtureSession();
    saveUserProfile("Alen", storage, { setupPending: true });
    const blocked = { setItem(key, value) { if (key === failKey) throw Error("Storage blocked"); storage.setItem(key, value); } };
    const choice = { engine: "tools", modelId: defaultConversationModel };
    const result = finishFirstRun("Alen", choice, runtime.session, defaults(), blocked);
    assert.equal(result.persisted, false); assert.equal(readUserProfile(storage).setupPending, true);
    const retried = finishFirstRun("Alen", choice, runtime.session, defaults(), storage);
    assert.equal(retried.persisted, true); assert.equal(readUserProfile(storage).setupPending, undefined);
    assert.equal(readConversationSettings(storage).engine, "tools");
  }
});

test("unavailable storage still permits a visit while invalid or busy setup choices cannot write anything", () => {
  const runtime = fixtureSession(), choice = { engine: "tools", modelId: defaultConversationModel };
  const result = finishFirstRun("Alen", choice, runtime.session, defaults(), { setItem() { throw Error("Denied"); } });
  assert.equal(result.persisted, false); assert.equal(result.profilePersisted, false);
  const storage = memory();
  for (const state of ["loading", "generating"]) assert.throws(() => finishFirstRun("Alen", choice, { getSnapshot: () => ({ status: state, modelId: defaultConversationModel }), unload() { assert.fail("Busy choices must not mutate the runtime"); } }, defaults(), storage), /setup_busy/);
  assert.throws(() => finishFirstRun("Alen", { ...choice, engine: "unknown" }, runtime.session, defaults(), storage), /setup_engine_required/);
  assert.throws(() => finishFirstRun("Alen", { ...choice, modelId: "unknown" }, runtime.session, defaults(), storage), /unsupported_model/);
  assert.equal(storage.writes.length, 0);
});

test("conversation settings restore safely and retain desktop GPU and legacy phone rules", () => {
  for (const raw of [null, "invalid{", " ".repeat(10001), "[]", "null"]) assert.equal(readConversationSettings({ getItem: () => raw }).modelId, defaultConversationModel);
  assert.equal(readConversationSettings({ getItem() { throw Error("Denied"); } }).engine, "chat");
  const legacyCpu = { getItem: () => JSON.stringify({ modelId: defaultCpuModel }) };
  assert.equal(readConversationSettings(legacyCpu).modelId, defaultConversationModel);
  assert.equal(readConversationSettings(legacyCpu, true).modelId, defaultCpuModel);
  assert.equal(readConversationSettings({ getItem: () => null }, true).modelId, defaultPhoneGpuModel);
});
