// Copyright © 2026 Alen Pepa
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const managedLinux = readExecutionProfile() === "managed-linux";
const preview = spawnSync(process.execPath, [fileURLToPath(new URL("./prepare-preview-runtime.mjs", import.meta.url))], { stdio: "inherit" });
if (preview.error) throw preview.error;
if (preview.status !== 0) process.exit(preview.status ?? 1);

if (command === "build") {
  const cpu = spawnSync(process.execPath, [fileURLToPath(new URL("./prepare-cpu-runtime.mjs", import.meta.url))], { stdio: "inherit" });
  if (cpu.error) throw cpu.error;
  if (cpu.status !== 0) process.exit(cpu.status ?? 1);
  const catalog = spawnSync(process.execPath, [fileURLToPath(new URL("./export-model-catalog.mjs", import.meta.url)), "--check"], { stdio: "inherit" });
  if (catalog.error) throw catalog.error;
  if (catalog.status !== 0) process.exit(catalog.status ?? 1);
  const result = spawnSync(managedLinux ? "bash" : process.execPath, managedLinux ? [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ] : [fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)), "build", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const attribution = spawnSync(process.execPath, [fileURLToPath(new URL("./finalize-copyright.mjs", import.meta.url))], { stdio: "inherit" });
  if (attribution.error) throw attribution.error;
  process.exit(attribution.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
