/*! Copyright © 2026 Alen Pepa. AELVOR application integration; third-party notices retained. */
// Optional local companion. Node.js 22+ on Windows; no npm packages required.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

export const bridgePort = 47321;
export const bridgeDefaultOrigin = "https://aegis-cyber-agent-alen.xalenpepa3.chatgpt.site";
export const bridgeLimits = { command: 6000, body: 65536, output: 131072, timeoutMs: 30000, sessions: 1024 };
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export function validateBridgeRun(value) {
  if (!value || !safeId(value.id) || !["powershell", "cmd"].includes(value.shell) || typeof value.command !== "string" || !value.command.trim() || value.command.length > bridgeLimits.command || value.command.includes("\0") || value.confirmed !== true) throw Error("invalid_command");
  if (value.timeoutMs !== undefined && ![30000, 60000, 180000].includes(value.timeoutMs)) throw Error("invalid_command");
  return { id: value.id, shell: value.shell, command: value.command, timeoutMs: value.timeoutMs || 30000 };
}
function authenticated(provided, token) { return typeof provided === "string" && /^[a-f0-9]{64}$/i.test(provided) && timingSafeEqual(Buffer.from(provided.toLowerCase(), "hex"), Buffer.from(token.toLowerCase(), "hex")); }

export function createBridgeProtocol({ token, origin = bridgeDefaultOrigin, root, platform = process.platform, run }) {
  if (!/^[a-f0-9]{64}$/i.test(token) || new URL(origin).origin !== origin || new URL(origin).protocol !== "https:") throw Error("invalid_configuration");
  const used = new Set(); let active = null, recoveryRequired = false;
  const response = (status, data, allowed = true) => ({ status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Aelvor-Session" } : {}) }, data });
  async function dispatch({ method, pathname, headers, body = "", remoteAddress = "127.0.0.1" }) {
    if (remoteAddress !== "127.0.0.1" || headers.host !== `127.0.0.1:${bridgePort}` || headers.origin !== origin) return response(403, { error: "invalid_origin" }, false);
    if (!["/health", "/run", "/cancel"].includes(pathname)) return response(404, { error: "not_found" });
    if (method === "OPTIONS") {
      const requested = String(headers["access-control-request-headers"] || "").toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
      if (requested.some(value => !["content-type", "x-aelvor-session"].includes(value)) || !["GET", "POST"].includes(headers["access-control-request-method"])) return response(403, { error: "invalid_preflight" });
      return response(204, null);
    }
    if (!authenticated(headers["x-aelvor-session"], token)) return response(401, { error: "invalid_session" });
    if (method === "GET" && pathname === "/health") return response(200, { protocol: "aelvor-windows-bridge", version: 1, platform, root, busy: Boolean(active), activeRunId: active?.id ?? null, recoveryRequired, timeoutMs: bridgeLimits.timeoutMs });
    if (method !== "POST" || pathname === "/health") return response(405, { error: "method_not_allowed" });
    if (!/^application\/json(?:;|$)/i.test(headers["content-type"] || "") || Buffer.byteLength(body) > bridgeLimits.body) return response(400, { error: "invalid_body" });
    let value; try { value = JSON.parse(body); } catch { return response(400, { error: "invalid_body" }); }
    if (pathname === "/cancel") {
      if (!safeId(value?.id) || !active || value.id !== active.id) return response(409, { error: "run_not_active" });
      active.controller.abort(); return response(202, { status: "cancellation_requested", id: value.id });
    }
    if (platform !== "win32") return response(409, { error: "windows_required" });
    let command; try { command = validateBridgeRun(value); } catch { return response(400, { error: "invalid_command" }); }
    if (used.has(command.id)) return response(409, { error: "run_already_used" });
    if (active) return response(409, { error: "bridge_busy" });
    if (recoveryRequired) return response(409, { error: "cleanup_unconfirmed" });
    if (used.size >= bridgeLimits.sessions) return response(429, { error: "restart_bridge" });
    used.add(command.id); const controller = new AbortController(); active = { id: command.id, controller };
    try { const result = await run(command, controller.signal); if (["timeout", "cancelled", "output_limit"].includes(result.status) && result.cleanupConfirmed !== true) recoveryRequired = true; return response(200, { ...result, id: command.id, shell: command.shell, command: command.command }); }
    catch { return response(500, { error: "execution_failed", id: command.id }); }
    finally { if (active?.id === command.id) active = null; }
  }
  return { dispatch, stop() { active?.controller.abort(); } };
}

export function windowsInvocation(shell, command, batchFile, systemRoot = process.env.SystemRoot || "C:\\Windows") {
  if (shell === "powershell") {
    const source = "# Copyright © 2026 Alen Pepa\n[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$OutputEncoding = [Console]::OutputEncoding\n" + command;
    return { executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")], env: {}, verbatim: false };
  }
  if (shell !== "cmd" || !batchFile) throw Error("invalid_command");
  // Expand one environment variable instead of interpolating a temporary path
  // into CMD syntax. /d disables AutoRun, /s applies CMD's outer quote rules.
  return { executable: path.win32.join(systemRoot, "System32", "cmd.exe"), args: ["/d", "/s", "/c", '""%AELVOR_RUN_FILE%""'], env: { AELVOR_RUN_FILE: batchFile }, verbatim: true };
}
function killWindowsTree(child, execute = execFile) {
  return new Promise(resolve => {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) { resolve(false); return; }
    const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    try { execute(executable, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 4000 }, error => resolve(!error)); } catch { resolve(false); }
  });
}
export function captureWindowsProcess(child, signal, { timeoutMs = bridgeLimits.timeoutMs, maximum = bridgeLimits.output, kill = killWindowsTree } = {}) {
  return new Promise(resolve => {
    const started = performance.now(), decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")], output = ["", ""]; let received = 0, done = false, reason = "", stopPromise, fallback;
    const finish = async (exitCode = null, failed = false) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(fallback); signal?.removeEventListener("abort", abort);
      const cleanupConfirmed = stopPromise ? await stopPromise : undefined;
      output[0] += decoders[0].end(); output[1] += decoders[1].end();
      resolve({ status: reason || (failed ? "error" : "completed"), exitCode: Number.isInteger(exitCode) ? exitCode : null, stdout: output[0], stderr: output[1], elapsedMs: Math.max(0, Math.round(performance.now() - started)), ...(reason ? { cleanupConfirmed: cleanupConfirmed === true } : {}) });
    };
    const stop = cause => {
      if (done || reason) return; reason = cause;
      stopPromise = Promise.race([Promise.resolve().then(() => kill(child)).catch(() => false), new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); timer.unref?.(); })]);
      fallback = setTimeout(() => { void finish(); }, 5100);
    };
    const abort = () => stop("cancelled"), timer = setTimeout(() => stop("timeout"), timeoutMs);
    for (const [index, stream] of [child.stdout, child.stderr].entries()) stream?.on("data", chunk => {
      if (done || reason) return; const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), remaining = Math.max(0, maximum - received); output[index] += decoders[index].write(bytes.subarray(0, remaining)); received += Math.min(remaining, bytes.length); if (bytes.length > remaining) stop("output_limit");
    });
    child.once("error", () => { void finish(null, true); }); child.once("close", code => { void finish(code); });
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}
export function createWindowsRunner(root, dependencies = {}) {
  const launch = dependencies.spawn || spawn;
  return async (command, signal) => {
    validateBridgeRun({ ...command, confirmed: true }); if (signal.aborted) return { status: "cancelled", exitCode: null, stdout: "", stderr: "", elapsedMs: 0, cleanupConfirmed: true };
    let directory;
    try {
      let batchFile;
      if (command.shell === "cmd") { directory = await mkdtemp(path.join(tmpdir(), "aelvor-command-")); batchFile = path.join(directory, "command.cmd"); await writeFile(batchFile, "@echo off\r\nREM Copyright © 2026 Alen Pepa\r\nchcp 65001 >nul\r\n" + command.command.replace(/\r?\n/g, "\r\n") + "\r\n", { encoding: "utf8", mode: 0o600 }); }
      if (signal.aborted) return { status: "cancelled", exitCode: null, stdout: "", stderr: "", elapsedMs: 0, cleanupConfirmed: true };
      const invocation = windowsInvocation(command.shell, command.command, batchFile);
      const child = launch(invocation.executable, invocation.args, { cwd: root, env: { ...process.env, ...invocation.env }, shell: false, windowsHide: true, windowsVerbatimArguments: invocation.verbatim, stdio: ["ignore", "pipe", "pipe"] });
      return await captureWindowsProcess(child, signal, { ...dependencies.captureOptions, timeoutMs: dependencies.captureOptions?.timeoutMs ?? command.timeoutMs ?? bridgeLimits.timeoutMs });
    } finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}); }
  };
}
export async function startBridge({ root, origin = bridgeDefaultOrigin, platform = process.platform, token = randomBytes(32).toString("hex") }) {
  if (platform !== "win32") throw Error("This companion runs on Windows only.");
  if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node.js 22 or later is required.");
  const resolved = await realpath(path.resolve(root)); if (!/^[a-z]:\\/i.test(resolved)) throw Error("Choose a local Windows drive folder such as C:\\Projects; UNC shares are not supported."); if (!(await stat(resolved)).isDirectory()) throw Error("Choose an existing project folder.");
  const protocol = createBridgeProtocol({ token, origin, root: resolved, platform, run: createWindowsRunner(resolved) });
  const server = createServer(async (request, response) => {
    if (request.socket.remoteAddress !== "127.0.0.1" || request.headers.host !== `127.0.0.1:${bridgePort}` || request.headers.origin !== origin) { response.writeHead(403, { "Cache-Control": "no-store" }); response.end(); return; }
    const chunks = []; let length = 0;
    try {
      for await (const bytes of request) { length += bytes.length; if (length > bridgeLimits.body) { response.writeHead(413); response.end(); request.destroy(); return; } chunks.push(bytes); }
      const result = await protocol.dispatch({ method: request.method, pathname: request.url, headers: request.headers, body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), remoteAddress: request.socket.remoteAddress });
      if (!response.destroyed) { response.writeHead(result.status, result.headers); response.end(result.status === 204 ? undefined : JSON.stringify(result.data)); }
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000; server.maxConnections = 8;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(bridgePort, "127.0.0.1", resolve); });
  return { server, token, root: resolved, origin, stop() { protocol.stop(); server.close(); server.closeIdleConnections(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), rootIndex = args.indexOf("--root"), originIndex = args.indexOf("--origin");
  if (args.includes("--help") || rootIndex < 0 || !args[rootIndex + 1]) console.log('Copyright © 2026 Alen Pepa\nUsage: node aelvor-windows-bridge.mjs --root "C:\\Projects\\MyApp" [--origin "https://your-site"]\nNode.js 22+ on Windows. Commands run with your user permissions; the project folder is an initial working directory, not a filesystem sandbox. Keep this terminal open; Ctrl+C stops the companion.');
  else {
    try {
      const bridge = await startBridge({ root: args[rootIndex + 1], origin: originIndex < 0 ? bridgeDefaultOrigin : args[originIndex + 1] });
      console.log(`Copyright © 2026 Alen Pepa\nAELVOR Windows companion · http://127.0.0.1:${bridgePort}\nAllowed app: ${bridge.origin}\nInitial folder: ${bridge.root}\nSession token (paste only into your AELVOR Windows terminal panel):\n${bridge.token}\nCommands run only when submitted from that authenticated app. Review each command before Run. Ctrl+C stops the companion.`);
      process.once("SIGINT", () => { bridge.stop(); }); process.once("SIGTERM", () => { bridge.stop(); });
    } catch (error) { console.error(`AELVOR companion could not start: ${error instanceof Error ? error.message : "unknown error"}`); process.exitCode = 1; }
  }
}
