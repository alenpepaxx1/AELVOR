// Copyright © 2026 Alen Pepa
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/hardware/aelvor-hardware.ps1", import.meta.url));
const shipped = await readFile(new URL("../dist/client/hardware/aelvor-hardware.ps1", import.meta.url));
assert.deepEqual(shipped, source, "The downloadable Windows collector must match the reviewed source");
console.log("Windows hardware collector is packaged unchanged at its same-origin download path. Windows execution remains unverified.");
