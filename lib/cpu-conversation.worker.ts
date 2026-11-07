// Copyright © 2026 Alen Pepa
import { createCpuPipeline } from "./cpu-pipeline.ts";
import { createCpuWorkerHandler } from "./cpu-worker-protocol.ts";

self.onmessage = event => { void handle(event.data); };
const handle = createCpuWorkerHandler(createCpuPipeline, reply => self.postMessage(reply));
