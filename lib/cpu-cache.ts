// Copyright © 2026 Alen Pepa
import { responseBytes, type DownloadInfo } from "./model-download.ts";
import { cpuModelBaseUrl, type CpuModel } from "./cpu-models.ts";

export const cpuCacheName = "aelvor-cpu-models-v1";
const metadataLimit = 16 * 1024 * 1024;
const requiredFiles = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
const optionalFiles = ["generation_config.json", "special_tokens_map.json", "added_tokens.json"];
type ModelCache = Pick<Cache, "match" | "put" | "delete">;

export function cpuCacheFile(model: CpuModel, key: string): string | null {
  const base = cpuModelBaseUrl(model);
  return key.startsWith(base) && [...requiredFiles, ...optionalFiles].includes(key.slice(base.length)) ? key.slice(base.length) : null;
}

export async function validateCpuFile(model: CpuModel, file: string, response: Response, signal: AbortSignal): Promise<void> {
  if (!response.ok) throw Error("cpu_download_invalid");
  if (file === "onnx/model_quantized.onnx") {
    const { bytes } = await responseBytes(response, signal, model.weightBytes);
    if (bytes !== model.weightBytes) throw Error("cpu_download_size");
    return;
  }
  const { data } = await responseBytes(response, signal, metadataLimit, true);
  let item;
  try { item = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { throw Error("cpu_download_metadata"); }
  if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("cpu_download_metadata");
  if (file === "config.json" && (item.model_type !== (model.modelType || "qwen2") || !Number.isFinite(item.max_position_embeddings) || item.max_position_embeddings < model.contextWindow)) throw Error("cpu_download_metadata");
  if (file === "tokenizer.json" && (!item.model || !item.model.vocab || typeof item.model.vocab !== "object" || !Object.keys(item.model.vocab).length)) throw Error("cpu_download_metadata");
  if (file === "tokenizer_config.json" && (typeof item.chat_template !== "string" || !item.chat_template.trim())) throw Error("cpu_download_metadata");
}

export function verifiedCpuCache(model: CpuModel, cache: ModelCache, signal: AbortSignal) {
  const verified = new Set<string>();
  const match = async (key: string): Promise<Response | undefined> => {
    const file = cpuCacheFile(model, key); if (!file) return undefined;
    const response = await cache.match(key); if (!response) return undefined;
    if (!verified.has(file)) {
      try { await validateCpuFile(model, file, response, signal); verified.add(file); }
      catch (error) { if (signal.aborted) throw error; await cache.delete(key); return undefined; }
      // Read a fresh cached response after the streaming audit; cloning a large
      // weight stream would retain the unread branch in memory during the audit.
      return (await cache.match(key)) || undefined;
    }
    return response;
  };
  return {
    match,
    async put(key: string, response: Response) {
      const file = cpuCacheFile(model, key); if (!file) throw Error("cpu_download_source");
      // SDK has already checked downloaded weight bytes in its progress hook.
      // A clone here is bounded by the SDK's already materialized input buffer.
      await validateCpuFile(model, file, response.clone(), signal);
      if (signal.aborted) throw signal.reason;
      await cache.put(key, response); verified.add(file);
    },
    async summary(responseTested: boolean): Promise<DownloadInfo> {
      const present = await Promise.all(requiredFiles.map(file => cache.match(`${cpuModelBaseUrl(model)}${file}`)));
      try { return { weightBytes: model.weightBytes, shardCount: 1, cachedShards: present.at(-1) && verified.has("onnx/model_quantized.onnx") ? 1 : 0, cacheComplete: present.every(Boolean) && requiredFiles.every(file => verified.has(file)), responseTested }; }
      finally { for (const response of present) void response?.body?.cancel().catch(() => {}); }
    },
  };
}

export async function clearCpuCache(model: CpuModel, storage: CacheStorage = globalThis.caches): Promise<void> {
  if (!(await storage.keys()).includes(cpuCacheName)) return;
  const cache = await storage.open(cpuCacheName);
  for (const request of await cache.keys()) if (cpuCacheFile(model, request.url)) await cache.delete(request);
}
