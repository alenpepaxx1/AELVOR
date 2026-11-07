// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { captureWindowsProcess, createBridgeProtocol, bridgeDefaultOrigin as origin } from "../public/windows/aelvor-windows-bridge.mjs";
import { WindowsBridgeClient, validateWindowsResult, reconnectWindowsRun } from "../lib/windows-terminal.ts";
import { fetchWebSource, webSourceResponse } from "../lib/web-sources.ts";
const token = "c".repeat(64), headers = { host: "127.0.0.1:47321", origin, "x-aelvor-session": token, "content-type": "application/json" };
test("command elapsed time stays valid when the Windows wall clock moves backwards", async () => {
  const original = Date.now; let clock = 100000;
  try {
    Date.now = () => clock -= 10000;
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    const pending = captureWindowsProcess(child, new AbortController().signal); queueMicrotask(() => child.emit("close", 0));
    const result = await pending;
    assert.ok(result.elapsedMs >= 0 && result.elapsedMs < 10000);
    assert.equal(validateWindowsResult({ ...result, id: "run", shell: "powershell", command: "Get-Location" }).status, "completed");
  } finally { Date.now = original; }
});
test("reconnecting recovers the active command ID for cancellation without executing it again", async () => {
  let finish, capturedSignal, executions = 0;
  const protocol = createBridgeProtocol({ token, origin, root: "C:\\Project", platform: "win32", run: async (_request, signal) => { executions++; capturedSignal = signal; return new Promise(resolve => { finish = resolve; }); } });
  const command = { id: "original-run", shell: "powershell", command: "Get-Location", confirmed: true, timeoutMs: 30000 };
  const pending = protocol.dispatch({ method: "POST", pathname: "/run", headers, body: JSON.stringify(command) });
  const reconnect = new WindowsBridgeClient(token, async (url, options) => {
    const response = await protocol.dispatch({ method: options.method, pathname: new URL(url).pathname, headers: { ...Object.fromEntries(new Headers(options.headers)), host: headers.host, origin }, body: options.body || "" });
    return Response.json(response.data, { status: response.status });
  });
  try {
    const health = await reconnect.health(); assert.equal(health.activeRunId, "original-run");
    await reconnect.cancel(health.activeRunId); assert.equal(capturedSignal.aborted, true); assert.equal(executions, 1);
  } finally { finish({ status: "cancelled", exitCode: null, stdout: "", stderr: "", elapsedMs: 1, cleanupConfirmed: true }); await pending; }
  assert.equal((await reconnect.health()).activeRunId, undefined);
});
test("a broken upstream stream is a download error rather than a false size-limit error", async () => {
  const fetcher = async () => new Response(new ReadableStream({ start(controller) { controller.error(Error("connection reset")); } }), { headers: { "Content-Type": "text/plain" } });
  await assert.rejects(fetchWebSource("https://nodejs.org/", new AbortController().signal, fetcher), /web_source_download/);
});
test("oversized web-reader requests are rejected as client input before fetching a source", async () => {
  let calls = 0;
  const request = new Request("https://aelvor.test/api/knowledge/web", { method: "POST", headers: { Origin: "https://aelvor.test", "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://nodejs.org/", extra: "x".repeat(3000) }) });
  const response = await webSourceResponse(request, async () => { calls++; return new Response("source"); });
  assert.equal(response.status, 413); assert.equal((await response.json()).error, "web_source_request_size"); assert.equal(calls, 0);
});
test("web-reader non-JSON requests are rejected before upstream network access", async () => {
  let calls = 0;
  const request = new Request("https://aelvor.test/api/knowledge/web", { method: "POST", headers: { Origin: "https://aelvor.test", "Content-Type": "text/plain" }, body: JSON.stringify({ url: "https://nodejs.org/" }) });
  const response = await webSourceResponse(request, async () => { calls++; return new Response("source", { headers: { "Content-Type": "text/plain" } }); });
  assert.equal(response.status, 415); assert.equal(calls, 0);
});
test("observing an active command does not make it owned by the reconnecting panel", () => {
  const client = new WindowsBridgeClient(token), health = { protocol: "aelvor-windows-bridge", version: 1, platform: "win32", root: "C:\\Project", busy: true, recoveryRequired: false, timeoutMs: 30000, activeRunId: "existing" };
  const observed = reconnectWindowsRun(health, client, null); assert.equal(observed.id, "existing"); assert.equal(observed.owned, false);
  const owned = { ...observed, owned: true };
  assert.equal(reconnectWindowsRun(health, client, owned).owned, true);
  assert.equal(reconnectWindowsRun({ ...health, activeRunId: "another" }, client, owned).owned, false);
  assert.equal(reconnectWindowsRun({ ...health, busy: false, activeRunId: undefined }, client, owned), null);
});
test("old companions remain readable without inventing an active request identity", async () => {
  const health = { protocol: "aelvor-windows-bridge", version: 1, platform: "win32", root: "C:\\Project", busy: true, recoveryRequired: false, timeoutMs: 30000 };
  const client = new WindowsBridgeClient(token, async () => Response.json(health));
  const restored = await client.health(); assert.equal(restored.activeRunId, undefined); assert.equal(reconnectWindowsRun(restored, client, null), null);
  const pending = { id: "own-known-id", client, owned: true }; assert.equal(reconnectWindowsRun(restored, client, pending), pending);
});
test("invalid or idle active-command identities are rejected at the client boundary", async () => {
  const health = { protocol: "aelvor-windows-bridge", version: 1, platform: "win32", root: "C:\\Project", busy: true, recoveryRequired: false, timeoutMs: 30000 };
  for (const bad of [{ ...health, activeRunId: "../wrong" }, { ...health, busy: false, activeRunId: "stale-id" }]) await assert.rejects(new WindowsBridgeClient(token, async () => Response.json(bad)).health(), /windows_response/);
});
test("empty and invalid UTF-8 web-reader bodies do not silently become upstream URLs", async () => {
  let calls = 0; const fetcher = async () => { calls++; return new Response("source", { headers: { "Content-Type": "text/plain" } }); };
  const prefix = new TextEncoder().encode('{"url":"https://nodejs.org/'), suffix = new TextEncoder().encode('"}'), invalid = new Uint8Array([...prefix, 255, ...suffix]);
  for (const body of [undefined, invalid]) {
    const request = new Request("https://aelvor.test/api/knowledge/web", { method: "POST", headers: { Origin: "https://aelvor.test", "Content-Type": "application/json" }, ...(body ? { body } : {}) });
    assert.equal((await webSourceResponse(request, fetcher)).status, 400);
  }
  assert.equal(calls, 0);
});
