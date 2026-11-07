"use client";
// Copyright © 2026 Alen Pepa

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { abortable } from "../lib/conversation";
import { ConversationSession, initialSessionState } from "../lib/conversation-session";
import type { DeviceBudget } from "../lib/device-capabilities";
import { createConversationLoader } from "../lib/conversation-loader";
import type { GpuPreference } from "../lib/gpu-selection";

export function useConversationSession(budget: DeviceBudget = {}, gpuPreference: GpuPreference = "auto") {
  const budgetRef = useRef(budget);
  budgetRef.current = budget;
  const gpuPreferenceRef = useRef(gpuPreference);
  gpuPreferenceRef.current = gpuPreference;
  const [session] = useState(() => new ConversationSession({ load: createConversationLoader({
    cpu: async (modelId, options) => {
      const { loadCpuConversation } = await abortable(import("../lib/cpu-conversation"), options.signal);
      return loadCpuConversation(modelId, { ...options, budget: budgetRef.current });
    },
    gpu: async (modelId, options) => {
      const { loadBrowserConversation } = await abortable(import("../lib/browser-conversation"), options.signal);
      return loadBrowserConversation(modelId, { ...options, budget: budgetRef.current, gpuPreference: gpuPreferenceRef.current });
    },
  }) }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, () => initialSessionState);
  useEffect(() => () => session.unload(), [session]);
  const state = useMemo(() => ({ ...snapshot, status: snapshot.status === "generating" ? "ready" as const : snapshot.status }), [snapshot]);
  return { session, state, ready: snapshot.status === "ready" || snapshot.status === "generating" };
}
