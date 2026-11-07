// Copyright © 2026 Alen Pepa
import CpuConversationWorker from "./cpu-conversation.worker?worker";
import { abortable, aborted } from "./conversation.ts";
import { inspectDevice, type DeviceBudget, type DeviceCapabilities } from "./device-capabilities.ts";
import { getCpuModel, requireCpuResources } from "./cpu-models.ts";
import { CpuWorkerClient } from "./cpu-worker-client.ts";
import type { ConversationRuntime, SessionLoader } from "./conversation-session.ts";
import { mobileExecutionLimits } from "./mobile-device.ts";

export async function loadCpuConversation(modelId: string, options: Parameters<SessionLoader>[1] & { budget?: DeviceBudget; inspect?: () => Promise<DeviceCapabilities> }): Promise<ConversationRuntime> {
  const model = getCpuModel(modelId); if (!model) throw Error("unsupported_model");
  if (options.signal.aborted) throw aborted();
  const device = await abortable((options.inspect || inspectDevice)(), options.signal);
  const report = requireCpuResources(model, device, options.budget);
  const limits = mobileExecutionLimits(device.mobile, "cpu", model.contextWindow);
  if (options.signal.aborted) throw aborted();
  // No worker, library import or model download starts before the resource gate.
  const client = new CpuWorkerClient(new CpuConversationWorker(), options.onFatal);
  const cancel = () => client.dispose(aborted());
  options.signal.addEventListener("abort", cancel, { once: true });
  try {
    const download = await client.load(modelId, Math.min(report.threads, limits.maxCpuThreads), options.onProgress, limits);
    if (options.signal.aborted) throw aborted();
    return { modelId, adapter: client.adapter, download, characterBudget: limits.characterBudget, cancelRequiresReload: true, dispose: () => { options.signal.removeEventListener("abort", cancel); client.dispose(); } };
  } catch (error) { options.signal.removeEventListener("abort", cancel); client.dispose(); throw error; }
}
