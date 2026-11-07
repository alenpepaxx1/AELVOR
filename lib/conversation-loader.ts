// Copyright © 2026 Alen Pepa
import { getChatModel } from "./chat-models.ts";
import type { SessionLoader } from "./conversation-session.ts";

// A failed GPU load must surface its original error. CPU is a separate model
// selection, never an automatic fallback that silently changes the processor.
export function createConversationLoader(loaders: { gpu: SessionLoader; cpu: SessionLoader }): SessionLoader {
  return (modelId, options) => {
    const model = getChatModel(modelId); if (!model) return Promise.reject(Error("unsupported_model"));
    return model.backend === "cpu" ? loaders.cpu(modelId, options) : loaders.gpu(modelId, options);
  };
}
