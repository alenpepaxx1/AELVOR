// Copyright © 2026 Alen Pepa
import { parentPort, workerData } from "node:worker_threads";
// Only adapt the worker message transport. This does not emulate WebGPU or a
// browser; the emitted production SDK handler is imported and runs unchanged.
globalThis.self = globalThis;
// Browser workers expose their script URL. Use a read-only URL fixture for
// browser-only dependency resolution; no browser or preview address is opened.
globalThis.location = new URL(workerData.scriptLocation || workerData.entry);
globalThis.postMessage = data => parentPort.postMessage(data);
await import(workerData.entry);
parentPort.on("message", data => globalThis.onmessage(new MessageEvent("message", { data })));
