// Copyright © 2026 Alen Pepa
import { getChatModel } from "./chat-models.ts";
import { selectedRuntimePreference } from "./runtime-preference.ts";
import { normalizeConversationSettings, writeConversationSettings, type ChatEngine, type ConversationSettings } from "./conversation-settings.ts";
import { saveUserProfile, validUsername } from "./user-profile.ts";

export type FirstRunChoice = { engine: ChatEngine; modelId: string; loadLater?: boolean };
type RuntimeState = { status: string; modelId: string | null };
type FirstRunRuntime = { getSnapshot: () => RuntimeState; unload: () => void };
export function selectFirstRunEngine(engine: ChatEngine, runtime: FirstRunRuntime): ChatEngine {
  if (engine !== "chat" && engine !== "tools") throw Error("setup_engine_required");
  if (engine === "tools") runtime.unload();
  return engine;
}
export function requireFirstRunChoice(choice: FirstRunChoice, runtime: RuntimeState): void {
  if (choice.engine !== "chat" && choice.engine !== "tools") throw Error("setup_engine_required");
  if (!getChatModel(choice.modelId)) throw Error("unsupported_model");
  if (runtime.status === "loading" || runtime.status === "generating") throw Error("setup_busy");
  if (choice.engine === "chat" && choice.loadLater !== true && (runtime.status !== "ready" || runtime.modelId !== choice.modelId)) throw Error("setup_model_not_ready");
}

// Persist engine/model choices BEFORE marking the profile complete. If either
// write fails, the active visit may continue, while a saved pending profile
// resumes the model step next time. No chat, draft or classifier is overwritten.
export function finishFirstRun(username: string, choice: FirstRunChoice, runtime: FirstRunRuntime, previous: ConversationSettings, storage?: Pick<Storage, "setItem">) {
  if (!validUsername(username)) throw Error("invalid_username");
  requireFirstRunChoice(choice, runtime.getSnapshot());
  if (choice.engine === "tools" || choice.loadLater === true) runtime.unload();
  const settings = normalizeConversationSettings({ ...previous, ...selectedRuntimePreference(choice.modelId), engine: choice.engine });
  const settingsPersisted = writeConversationSettings(settings, storage);
  const result = saveUserProfile(username, storage, { setupPending: !settingsPersisted });
  return { settings, profile: result.profile, profilePersisted: result.persisted, persisted: settingsPersisted && result.persisted };
}
