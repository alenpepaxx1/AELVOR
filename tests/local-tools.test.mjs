// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extractArtifacts, extractIndicators, formatJson, hashSha256, inspectUrl } from "../lib/local-tools.ts";
import { COPYRIGHT_NOTICE } from "../lib/brand.ts";

test("URL inspection reveals the real host behind user information without visiting it", () => {
  const value = inspectUrl("http://login.example.com:password@192.0.2.10/verify?redirect=https%3A%2F%2Fexample.org%2Flogin&token=private");
  assert.equal(value.host, "192.0.2.10");
  assert.equal(value.port, "80");
  assert.deepEqual(new Set(value.signals), new Set(["http", "credentials", "ip", "secret", "redirect"]));
  assert.ok(!JSON.stringify(value).includes("password"));
  assert.ok(!JSON.stringify(value).includes("private"));
  assert.throws(() => inspectUrl("javascript:alert(1)"), /invalid_url/);
  assert.throws(() => inspectUrl("example.org"), /invalid_url/);
});

test("URL parser handles Unicode domains and relative redirects conservatively", () => {
  const value = inspectUrl("https://bücher.example/?next=%2Faccount");
  assert.equal(value.host, "xn--bcher-kva.example");
  assert.deepEqual(value.signals, ["idn"]);
  assert.deepEqual(inspectUrl("https://example.org/").signals, []);
});

test("indicator extraction deduplicates candidates and rejects invalid IPv4 addresses", () => {
  const result = extractIndicators("src=192.0.2.4 repeated=192.0.2.4 bad=999.1.2.3 zero=001.2.3.4 embedded=1192.0.2.1 test=https://example.org/test). email=security@example.org hash=" + "ABCDEF12".repeat(8));
  assert.deepEqual(result.ipv4, ["192.0.2.4"]);
  assert.deepEqual(result.urls, ["https://example.org/test"]);
  assert.deepEqual(result.emails, ["security@example.org"]);
  assert.deepEqual(result.sha256, ["abcdef12".repeat(8)]);
  assert.equal(extractIndicators(Array.from({ length: 300 }, (_, i) => `https://example.org/${i}`).join(" ")).urls.length, 200);
  assert.throws(() => extractIndicators("x".repeat(100001)), /too_long/);
});

test("JSON formatting preserves adversarial strings as data and rejects broken syntax", () => {
  const input = '{"html":"<script>alert(1)</script>","__proto__":{"polluted":true},"count":0,"value":null}';
  assert.deepEqual(JSON.parse(formatJson(input)), JSON.parse(input));
  assert.equal({}.polluted, undefined);
  assert.throws(() => formatJson('{"x":}'), /invalid_json/);
});

test("SHA-256 matches standard vectors for UTF-8 text and binary data", async () => {
  for (const input of ["", "abc", "Grüß dich 🔒"]) assert.equal(await hashSha256(input), createHash("sha256").update(input).digest("hex"));
  const bytes = new Uint8Array([0, 1, 128, 255]);
  assert.equal(await hashSha256(bytes.buffer), createHash("sha256").update(bytes).digest("hex"));
});

test("artifact extraction ignores user-provided blocks and unfinished code fences", () => {
  const artifacts = extractArtifacts([
    { id: "u", role: "user", content: "```python\nuser_code()\n```" },
    { id: "a", role: "assistant", content: "## File hash\n```python\nprint('hello')\n```\n```bash\npython file.py\n```", demo: true },
    { id: "b", role: "assistant", content: "```javascript\nunfinished" },
  ]);
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].filename, "aelvor-1.py");
  assert.equal(artifacts[0].content, `# ${COPYRIGHT_NOTICE}\nprint('hello')`);
  assert.equal(artifacts[1].filename, "aelvor-2.sh");
  assert.equal(artifacts[0].demo, true);
});

test("artifact downloads use known extensions and never inherited Object prototype properties", () => {
  const source = "```constructor\nprint(1)\n```\n```typescript title=example.ts\nconst value = 1;\n```";
  const artifacts = extractArtifacts([{ id: "safe-filenames", role: "assistant", content: source }]).filter(item => item.kind === "code");
  assert.equal(artifacts[0].filename, "aelvor-1.txt");
  assert.equal(artifacts[1].filename, "aelvor-2.ts");
  assert.equal(artifacts[1].language, "typescript");
});
