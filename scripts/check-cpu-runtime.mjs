// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { cpuRuntimeDirectory } from "../lib/cpu-models.ts";

const require = createRequire(import.meta.resolve("@huggingface/transformers"));
const ortDist = dirname(require.resolve("onnxruntime-web"));
const ort = await import(pathToFileURL(join(ortDist, "ort.webgpu.bundle.min.mjs")).href);
const runtime = resolve(join("dist/client", cpuRuntimeDirectory));
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { mjs: pathToFileURL(join(runtime, "ort-wasm-simd-threaded.jsep.mjs")).href };
ort.env.wasm.wasmBinary = new Uint8Array(readFileSync(join(runtime, "ort-wasm-simd-threaded.jsep.wasm")));

// A tiny ONNX Add graph exercises the shipped CPU WASM kernel without model
// weights, browser emulation, a GPU, a network request or native Node addons.
const concat = (...parts) => new Uint8Array(parts.flatMap(part => [...part]));
const varint = value => { const bytes = []; do { const byte = value & 127; value >>>= 7; bytes.push(value ? byte | 128 : byte); } while (value); return bytes; };
const integer = (key, value) => concat(varint(key << 3), varint(value));
const message = (key, bytes) => concat(varint((key << 3) | 2), varint(bytes.length), bytes);
const string = (key, value) => message(key, new TextEncoder().encode(value));
const valueInfo = name => concat(string(1, name), message(2, message(1, concat(integer(1, 1), message(2, message(1, integer(1, 3)))))));
const node = concat(string(1, "left"), string(1, "right"), string(2, "sum"), string(4, "Add"));
const graph = concat(message(1, node), string(2, "aelvor-cpu-check"), message(11, valueInfo("left")), message(11, valueInfo("right")), message(12, valueInfo("sum")));
const model = concat(integer(1, 8), message(7, graph), message(8, integer(2, 13)));
const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
try {
  const result = await session.run({ left: new ort.Tensor("float32", new Float32Array([1, 2, 3]), [3]), right: new ort.Tensor("float32", new Float32Array([4, 5, 6]), [3]) });
  assert.deepEqual([...result.sum.data], [5, 7, 9]);
  console.log("Shipped ONNX Runtime CPU WebAssembly executed a real tensor graph successfully. Full chat models and physical GPU combinations remain unverified.");
} finally { await session.release(); }
