// Copyright © 2026 Alen Pepa
import type { ModelRecord } from "@mlc-ai/web-llm";
import { aborted, abortable } from "./conversation.ts";

export const modelCacheScopes = { config: "webllm/config", model: "webllm/model", wasm: "webllm/wasm" } as const;
export type DownloadInfo = { weightBytes: number; shardCount: number; cachedShards: number; cacheComplete: boolean; responseTested: boolean };
export type DownloadPlan = { baseUrl: string; wasmUrl: string; configUrl: string; packageUrl?: string; manifestUrl: string; tokenizerUrl: string; shards: { url: string; bytes: number }[]; weightBytes: number };
type Environment = { caches: CacheStorage; fetch: typeof fetch; timeoutMs?: number };
type JsonObject = Record<string, unknown>;
const metadataLimit = 16 * 1024 * 1024;

function checkSignal(signal: AbortSignal) { if (signal.aborted) throw aborted(); }
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model_download_metadata");
  return value as JsonObject;
}
function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("model_download_source");
  return url;
}
export function modelBaseUrl(record: Pick<ModelRecord, "model">): string {
  const url = httpsUrl(record.model.endsWith("/") ? record.model : `${record.model}/`);
  if (!/\/resolve\/[^/]+\//.test(url.pathname)) url.pathname += "resolve/main/";
  return url.href;
}
function resourceUrl(base: string, path: unknown): string {
  if (typeof path !== "string" || !path || /[\\?#%]/.test(path) || path.startsWith("/") || path.split("/").some(part => part === "." || part === ".." || !part)) throw new Error("model_download_metadata");
  const url = new URL(path, base);
  if (!url.href.startsWith(base) || url.origin !== new URL(base).origin) throw new Error("model_download_metadata");
  return url.href;
}

// Count streamed bytes without holding a multi-GB shard in JavaScript memory.
export async function responseBytes(response: Response, signal: AbortSignal, maximum: number, collect = false): Promise<{ bytes: number; data: Uint8Array<ArrayBuffer> }> {
  checkSignal(signal);
  if (!response.ok || !response.body) throw new Error("model_download_metadata");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0, done = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal); checkSignal(signal);
      if (chunk.done) { done = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maximum) throw new Error("model_download_size");
      if (collect) chunks.push(chunk.value);
    }
    const data = new Uint8Array(collect ? bytes : 0);
    let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, data };
  } finally { signal.removeEventListener("abort", cancel); if (!done) cancel(); reader.releaseLock(); }
}

async function parseMetadata(response: Response, signal: AbortSignal): Promise<unknown> {
  const { data } = await responseBytes(response, signal, metadataLimit, true);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
  catch { throw new Error("model_download_metadata"); }
}

async function metadata<T>(url: string, cache: Cache, validate: (value: unknown) => T, signal: AbortSignal, env: Environment): Promise<T> {
  checkSignal(signal);
  const cached = await cache.match(url); checkSignal(signal);
  if (cached) {
    try { return validate(await parseMetadata(cached, signal)); }
    catch (error) { checkSignal(signal); await cache.delete(url); }
  }
  // Retry a transient failure once. Permission and missing-file errors need a
  // different model/source, not repeated downloads. The deadline includes JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), env.timeoutMs ?? 30_000);
    try {
      checkSignal(signal);
      const pending = env.fetch(url, { signal: controller.signal });
      void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }).catch(() => {});
      const response = await abortable(pending, controller.signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`model_download_http_${response.status}`);
      }
      const { data } = await responseBytes(response, controller.signal, metadataLimit, true);
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
      catch { throw new Error("model_download_metadata"); }
      const value = validate(parsed); checkSignal(signal);
      await abortable(cache.put(url, new Response(data, { headers: { "Content-Type": "application/json" } })), controller.signal);
      checkSignal(controller.signal); checkSignal(signal); return value;
    } catch (error) {
      checkSignal(signal);
      const message = error instanceof Error ? error.message : "";
      const transient = controller.signal.aborted || error instanceof TypeError || /model_download_http_(408|429|5\d\d)$/.test(message);
      if (attempt === 0 && transient) continue;
      if (controller.signal.aborted) throw new Error("model_download_timeout");
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  }
  throw new Error("model_download_failed");
}

function shardsFrom(value: unknown, base: string): DownloadPlan["shards"] {
  const records = object(value).records;
  if (!Array.isArray(records) || !records.length || records.length > 100_000) throw new Error("model_download_metadata");
  const seen = new Set<string>(); let total = 0;
  return records.map(item => {
    const shard = object(item), url = resourceUrl(base, shard.dataPath), bytes = shard.nbytes;
    if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0 || seen.has(url)) throw new Error("model_download_metadata");
    total += bytes as number; if (!Number.isSafeInteger(total)) throw new Error("model_download_metadata");
    seen.add(url);
    if (!Array.isArray(shard.records) || !shard.records.length) throw new Error("model_download_metadata");
    for (const item of shard.records) {
      const tensor = object(item), offset = tensor.byteOffset, length = tensor.nbytes;
      if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(length) || (length as number) < 0 || (offset as number) + (length as number) > (bytes as number)) throw new Error("model_download_metadata");
    }
    return { url, bytes: bytes as number };
  });
}

function environment(env?: Environment): Environment {
  if (env) return env;
  if (!globalThis.caches) throw new Error("model_download_cache_unavailable");
  return { caches: globalThis.caches, fetch: globalThis.fetch.bind(globalThis) };
}

export async function prepareModelDownload(record: ModelRecord, signal: AbortSignal, env?: Environment): Promise<DownloadPlan> {
  const runtime = environment(env), baseUrl = modelBaseUrl(record), wasmUrl = httpsUrl(record.model_lib).href;
  const configCache = await runtime.caches.open(modelCacheScopes.config);
  const modelCache = await runtime.caches.open(modelCacheScopes.model);
  checkSignal(signal);
  let packageUrl: string | undefined;
  if (record.model_manifest) {
    packageUrl = resourceUrl(baseUrl, record.model_manifest);
    await metadata(packageUrl, configCache, value => {
      const manifest = object(value), weights = object(manifest.weights);
      if (manifest.schema !== "mlc.model-package" || manifest.schema_version !== 1 || (manifest.chat_config !== undefined && manifest.chat_config !== "mlc-chat-config.json") || weights.manifest !== "tensor-cache.json") throw new Error("model_download_metadata");
      // The SDK also validates compiler interface and parameter-schema hashes.
      return manifest;
    }, signal, runtime);
  }
  const configUrl = new URL("mlc-chat-config.json", baseUrl).href;
  const tokenizerUrl = await metadata(configUrl, configCache, value => {
    const config = object(value), files = record.overrides?.tokenizer_files ?? config.tokenizer_files;
    if (!Array.isArray(files)) throw new Error("model_download_metadata");
    const tokenizer = files.includes("tokenizer.json") ? "tokenizer.json" : files.includes("tokenizer.model") ? "tokenizer.model" : null;
    if (!tokenizer) throw new Error("model_download_tokenizer");
    // Validate the chat fields the pinned SDK will consume before weight loads.
    // Apply its record overrides and legacy partial conversation overrides.
    const effective = { ...config, ...record.overrides }, conversation = effective.conv_template;
    if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) throw Error("model_download_chat_config");
    const partial = effective.conv_config;
    if (partial != null && (typeof partial !== "object" || Array.isArray(partial))) throw Error("model_download_chat_config");
    const template = { ...object(conversation), ...(partial == null ? {} : object(partial)) }, roles = template.roles as JsonObject | undefined;
    if (!Number.isSafeInteger(effective.vocab_size) || Number(effective.vocab_size) <= 0 || typeof template.system_template !== "string" || !roles || typeof roles.user !== "string" || typeof roles.assistant !== "string" || !Array.isArray(template.seps) || !template.seps.length || template.seps.some(value => typeof value !== "string") || typeof template.role_content_sep !== "string" || typeof template.role_empty_sep !== "string") throw Error("model_download_chat_config");
    return resourceUrl(baseUrl, tokenizer);
  }, signal, runtime);
  const manifestUrl = new URL("tensor-cache.json", baseUrl).href;
  const shards = await metadata(manifestUrl, modelCache, value => shardsFrom(value, baseUrl), signal, runtime);
  return { baseUrl, wasmUrl, configUrl, packageUrl, manifestUrl, tokenizerUrl, shards, weightBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0) };
}

export async function inspectModelCache(plan: DownloadPlan, signal: AbortSignal, options: { repair: boolean; onShard?: (complete: number, total: number) => void }, env?: Environment): Promise<DownloadInfo> {
  const storage = environment(env).caches, cache = await storage.open(modelCacheScopes.model);
  let cachedShards = 0, damaged = false, index = 0;
  for (const shard of plan.shards) {
    checkSignal(signal); const response = await cache.match(shard.url); checkSignal(signal);
    if (response) {
      let valid = false;
      try { valid = (await responseBytes(response, signal, shard.bytes)).bytes === shard.bytes; }
      catch { checkSignal(signal); }
      if (valid) cachedShards++;
      else { await cache.delete(shard.url); damaged = true; }
    }
    options.onShard?.(++index, plan.shards.length);
  }
  if (damaged && !options.repair) throw new Error("model_download_size");
  let cacheComplete = cachedShards === plan.shards.length;
  const required = [[modelCacheScopes.config, plan.configUrl], [modelCacheScopes.model, plan.manifestUrl], [modelCacheScopes.model, plan.tokenizerUrl], [modelCacheScopes.wasm, plan.wasmUrl]];
  if (plan.packageUrl) required.push([modelCacheScopes.config, plan.packageUrl]);
  for (const [scope, url] of required) {
    checkSignal(signal); const response = await (await storage.open(scope)).match(url);
    if (!response?.ok) cacheComplete = false;
    void response?.body?.cancel().catch(() => {});
  }
  checkSignal(signal);
  return { weightBytes: plan.weightBytes, shardCount: plan.shards.length, cachedShards, cacheComplete, responseTested: false };
}

// Delete by scoped keys, never by fetching a possibly absent tensor manifest.
// Model variants can share these publisher files and compiled libraries.
export async function clearModelCache(record: ModelRecord, storage: CacheStorage = globalThis.caches): Promise<void> {
  if (!storage) throw new Error("model_download_cache_unavailable");
  const base = modelBaseUrl(record), wasm = httpsUrl(record.model_lib).href;
  const existing = await storage.keys();
  for (const scope of Object.values(modelCacheScopes)) {
    if (!existing.includes(scope)) continue;
    const cache = await storage.open(scope);
    for (const key of await cache.keys()) {
      if (scope === modelCacheScopes.wasm ? key.url === wasm : key.url.startsWith(base)) await cache.delete(key);
    }
  }
}
