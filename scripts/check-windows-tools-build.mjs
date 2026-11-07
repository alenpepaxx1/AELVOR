// Copyright © 2026 Alen Pepa
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = await readFile("public/windows/aelvor-windows-bridge.mjs"), built = await readFile("dist/client/windows/aelvor-windows-bridge.mjs");
if (createHash("sha256").update(source).digest("hex") !== createHash("sha256").update(built).digest("hex")) throw Error("Windows companion differs from reviewed source");
console.log("Windows companion is packaged unchanged as a static download. Protocol and child-process capture are tested; native Windows shells and browser loopback permissions remain unverified.");
