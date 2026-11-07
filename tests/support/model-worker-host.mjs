// Copyright © 2026 Alen Pepa
import { parentPort, workerData } from "node:worker_threads";
// Small Web Worker protocol adapter. The actual production training entry and
// model code execute in a separate Node thread; no browser is simulated here.
globalThis.self = { postMessage: data => parentPort.postMessage(data), onmessage: null };
await import(workerData.entry);
parentPort.on("message", data => globalThis.self.onmessage({ data }));
