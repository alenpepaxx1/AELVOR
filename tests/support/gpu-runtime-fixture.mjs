// Copyright © 2026 Alen Pepa
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { getConversationModel } from "../../lib/model-catalog.ts";
import { defaultConversationModel } from "../../lib/conversation.ts";
import { withModelResources } from "../../lib/model-load-gate.ts";

let sequence = 0;
const dataModule = code => `data:text/javascript;base64,${Buffer.from(`// Copyright © 2026 Alen Pepa\n${code}`).toString("base64")}`;
// Exercise the real browser loader as a normal module unit test. Only its SDK,
// network/cache and Worker boundaries are replaced. No browser, preview,
// model weights, GPU access or UI observation is involved.
export async function gpuRuntimeFixture({ device, reports, failWarmupAt = 0 }) {
  const key = `__aelvorGpuFixture${++sequence}`;
  const state = { device, reports, failWarmupAt, gate: withModelResources, downloads: 0, inspections: 0, workers: 0, terminated: 0, warmReplies: 0, warmRequests: [], resets: 0, model: getConversationModel(defaultConversationModel) };
  globalThis[key] = state;
  const ref = `globalThis[${JSON.stringify(key)}]`;
  const stubs = new Map([
    ["@mlc-ai/web-llm", dataModule(`const s=${ref}; export const prebuiltAppConfig={model_list:[{model_id:s.model.id,model:s.model.sourceUrl}]}; export async function CreateWebWorkerMLCEngine(worker,id,options){for(const report of s.reports) options.initProgressCallback(report); return {chat:{completions:{create:async request=>{s.warmReplies++;s.warmRequests.push(request);if(s.warmReplies===s.failWarmupAt)throw Error("template incompatible");if(!request.stream)throw Error("fixture requires streaming");return (async function*(){yield {choices:[{delta:{content:"OK"},finish_reason:"stop"}]};})();}}},resetChat:async()=>{s.resets++;},interruptGenerate(){}};}`)],
    ["./conversation.worker.ts?worker", dataModule(`export default class WorkerFixture {constructor(){${ref}.workers++;}addEventListener(){}removeEventListener(){}terminate(){${ref}.terminated++;}}`)],
    ["./model-download.ts", dataModule(`const s=${ref};export async function prepareModelDownload(){s.downloads++;return {};}export async function inspectModelCache(){s.inspections++;return {weightBytes:1,shardCount:1,cachedShards:1,cacheComplete:true};}export async function clearModelCache(){}`)],
    ["./model-load-gate.ts", dataModule(`const s=${ref};export function withModelResources(model,options,start){return s.gate(model,{...options,inspect:async()=>s.device},start);}`)],
  ]);
  const file = new URL("../../lib/browser-conversation.ts", import.meta.url);
  const source = await readFile(file, "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  for (const match of [...outputText.matchAll(/from (["'])([^"']+)\1/g)]) {
    const specifier = match[2], resolved = stubs.get(specifier) || new URL(specifier, file).href;
    outputText = outputText.replace(match[0], `from ${JSON.stringify(resolved)}`);
  }
  const module = await import(dataModule(outputText));
  return { state, load: module.loadBrowserConversation, cleanup() { delete globalThis[key]; } };
}
