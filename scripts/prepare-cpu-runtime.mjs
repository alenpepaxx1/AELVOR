// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { cpuRuntimeVersion, cpuRuntimeDirectory } from "../lib/cpu-models.ts";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";

const entry = fileURLToPath(import.meta.resolve("@huggingface/transformers")), sdkRoot = dirname(dirname(entry));
assert.equal(JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).version, cpuRuntimeVersion);
const destination = join("public", cpuRuntimeDirectory);
mkdirSync(destination, { recursive: true });
const name = "ort-wasm-simd-threaded.jsep";
copyFileSync(join(sdkRoot, "dist", `${name}.wasm`), join(destination, `${name}.wasm`));
const banner = `/*! ${COPYRIGHT_NOTICE}. AELVOR application integration; third-party notices retained. */`;
writeFileSync(join(destination, `${name}.mjs`), `${banner}\n${readFileSync(join(sdkRoot, "dist", `${name}.mjs`), "utf8")}`);
const ortRoot = dirname(dirname(createRequire(entry).resolve("onnxruntime-web")));
copyFileSync(join(ortRoot, "README.md"), join(destination, "ONNX-README.md"));
copyFileSync(join(sdkRoot, "LICENSE"), join(destination, "TRANSFORMERS-LICENSE.txt"));
// ONNX Runtime packages include their license in the distribution entrypoint.
writeFileSync(join(destination, "NOTICE.txt"), `${COPYRIGHT_NOTICE} — AELVOR integration.\nONNX Runtime: Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License.\nhttps://github.com/microsoft/onnxruntime/blob/main/LICENSE\nTransformers.js: Copyright Hugging Face. Apache-2.0. See TRANSFORMERS-LICENSE.txt.\n`);
writeFileSync(join(destination, "ONNX-LICENSE.txt"), `MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
console.log(`CPU WebAssembly assets prepared from Transformers.js ${cpuRuntimeVersion}.`);
