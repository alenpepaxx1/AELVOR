// Copyright © 2026 Alen Pepa
import { parentPort, workerData } from "node:worker_threads";
// Run the compiled worker's browser branch with only a message-transport adapter.
// No browser, preview UI, network or model-generated app is opened.
globalThis.self = globalThis;
globalThis.postMessage = data => parentPort.postMessage(data);
globalThis.process = undefined;
await import(workerData.entry);
parentPort.on("message", data => globalThis.onmessage(new MessageEvent("message", { data })));
