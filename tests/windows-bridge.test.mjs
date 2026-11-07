// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync, existsSync } from "node:fs";
import { createBridgeProtocol, validateBridgeRun, windowsInvocation, captureWindowsProcess, createWindowsRunner, bridgeDefaultOrigin as origin } from "../public/windows/aelvor-windows-bridge.mjs";
const token = "a".repeat(64), headers = { host: "127.0.0.1:47321", origin, "x-aelvor-session": token, "content-type": "application/json" };
const request = (pathname = "/health", body, extra = {}) => ({ method: body === undefined ? "GET" : "POST", pathname, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...extra });
const command = (id = "run1") => ({ id, shell: "powershell", command: "Get-Location", confirmed: true, timeoutMs: 30000 });
const result = { status: "completed", exitCode: 0, stdout: "done", stderr: "", elapsedMs: 1 };
test("bridge authenticates exact origin, host, loopback and token before running anything", async () => {
  let calls = 0; const protocol = createBridgeProtocol({ token, origin, root: "C:\\Projects", platform: "win32", run: async () => { calls++; return result; } });
  for (const changes of [{ origin: "https://evil.test" }, { host: "evil.test:47321" }, { "x-aelvor-session": "wrong" }, { "x-aelvor-session": undefined }]) assert.ok((await protocol.dispatch(request("/run", command(), { headers: { ...headers, ...changes } }))).status >= 400);
  assert.equal((await protocol.dispatch(request("/run", command(), { remoteAddress: "192.168.1.1" }))).status, 403); assert.equal(calls, 0);
  const health = await protocol.dispatch(request()); assert.equal(health.data.platform, "win32"); assert.doesNotMatch(JSON.stringify(health), new RegExp(token)); assert.equal(health.headers["Access-Control-Allow-Origin"], origin);
});
test("preflight is explicit, bounded to allowed methods/headers and never executes commands", async () => {
  const protocol = createBridgeProtocol({ token, origin, root: "C:\\Project", platform: "win32", run: () => assert.fail("preflight executed") });
  const preflight = { method: "OPTIONS", headers: { host: headers.host, origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-aelvor-session" } };
  assert.equal((await protocol.dispatch(request("/run", undefined, preflight))).status, 204);
  assert.equal((await protocol.dispatch(request("/run", undefined, { ...preflight, headers: { ...preflight.headers, "access-control-request-headers": "authorization" } }))).status, 403);
  assert.equal((await protocol.dispatch(request("/run?command=x", undefined, preflight))).status, 404);
});
test("execution requires reviewed valid input, allows one run and never repeats an accepted ID", async () => {
  let finish, calls = 0; const protocol = createBridgeProtocol({ token, origin, root: "C:\\Project", platform: "win32", run: async () => { calls++; return await new Promise(resolve => { finish = resolve; }); } });
  for (const bad of [{ ...command(), confirmed: false }, { ...command(), shell: "bash" }, { ...command(), command: "x".repeat(6001) }, { ...command(), timeoutMs: 1e9 }]) assert.equal((await protocol.dispatch(request("/run", bad))).status, 400);
  const pending = protocol.dispatch(request("/run", command())); await Promise.resolve();
  assert.equal((await protocol.dispatch(request("/run", command("another")))).data.error, "bridge_busy");
  assert.equal((await protocol.dispatch(request("/run", command()))).data.error, "run_already_used");
  finish(result); assert.equal((await pending).data.stdout, "done"); assert.equal((await protocol.dispatch(request("/run", command()))).status, 409); assert.equal(calls, 1);
});
test("cancellation targets the active request and unconfirmed cleanup blocks later executions", async () => {
  let finish, observed;
  const protocol = createBridgeProtocol({ token, origin, root: "C:\\Project", platform: "win32", run: async (_request, signal) => { observed = signal; return new Promise(resolve => { finish = resolve; }); } });
  const pending = protocol.dispatch(request("/run", command())); await Promise.resolve();
  assert.equal((await protocol.dispatch(request("/cancel", { id: "wrong" }))).status, 409); assert.equal(observed.aborted, false);
  assert.equal((await protocol.dispatch(request("/cancel", { id: "run1" }))).status, 202); assert.equal(observed.aborted, true);
  finish({ ...result, status: "cancelled", cleanupConfirmed: false }); await pending;
  assert.equal((await protocol.dispatch(request())).data.recoveryRequired, true);
  assert.equal((await protocol.dispatch(request("/run", command("next")))).data.error, "cleanup_unconfirmed");
});
test("PowerShell uses exact UTF-16 command encoding while CMD receives a fixed environment-variable path", () => {
  const invocation = windowsInvocation("powershell", 'Write-Output "Größe 😀"', undefined, "C:\\Windows");
  const source = Buffer.from(invocation.args.at(-1), "base64").toString("utf16le");
  assert.match(source, /Write-Output "Größe 😀"/); assert.ok(!invocation.args.includes("-ExecutionPolicy"));
  const batch = windowsInvocation("cmd", "npm test", "C:\\Users\\Name & %text%\\command.cmd", "C:\\Windows");
  assert.deepEqual(batch.args, ["/d", "/s", "/c", '""%AELVOR_RUN_FILE%""']); assert.equal(batch.env.AELVOR_RUN_FILE, "C:\\Users\\Name & %text%\\command.cmd"); assert.equal(batch.verbatim, true);
});
test("real process capture keeps split UTF-8 output and actual exit status", async () => {
  const child = spawn(process.execPath, ["-e", 'const b=Buffer.from("Größe 😀");process.stdout.write(b.subarray(0,3));setTimeout(()=>{process.stdout.write(b.subarray(3));process.stderr.write("diagnostic");process.exitCode=7},10)']);
  const value = await captureWindowsProcess(child, new AbortController().signal); assert.equal(value.stdout, "Größe 😀"); assert.equal(value.stderr, "diagnostic"); assert.equal(value.exitCode, 7); assert.equal(value.status, "completed");
});
test("timeout and output caps request termination and never claim success", async () => {
  for (const mode of ["timeout", "output_limit"]) {
    const child = spawn(process.execPath, ["-e", mode === "timeout" ? "setInterval(()=>{},1000)" : 'process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)']);
    const value = await captureWindowsProcess(child, new AbortController().signal, { timeoutMs: mode === "timeout" ? 30 : 2000, maximum: 100, kill: async process => { process.kill("SIGTERM"); return true; } });
    assert.equal(value.status, mode); assert.equal(value.cleanupConfirmed, true); assert.ok(value.stdout.length <= 100);
  }
});
test("CMD runner writes only its temporary script, uses the fixed project cwd and cleans it up", async () => {
  let file, seen;
  const runner = createWindowsRunner("C:\\Projects\\Chosen", { spawn(executable, args, options) {
    file = options.env.AELVOR_RUN_FILE; seen = { executable, args, options, source: readFileSync(file, "utf8") };
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); queueMicrotask(() => child.emit("close", 0)); return child;
  } });
  await runner({ ...command(), shell: "cmd", command: "echo Hello\nnpm test", cwd: "C:\\Other" }, new AbortController().signal);
  assert.equal(seen.options.cwd, "C:\\Projects\\Chosen"); assert.equal(seen.options.shell, false); assert.match(seen.source, /chcp 65001/); assert.match(seen.source, /echo Hello\r\nnpm test/); assert.equal(existsSync(file), false);
  assert.throws(() => validateBridgeRun({ ...command(), command: "x\0y" }), /invalid_command/);
});
