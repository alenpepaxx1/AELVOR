// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { readAttachments } from "../lib/attachments.ts";

const file = (name, content) => ({ name, size: content.length, text: async () => content });

test("file reads preserve full small text and explicitly mark large excerpts", async () => {
  const rejected = [], signal = new AbortController().signal;
  const result = await readAttachments([file("small.txt", "abc"), file("large.log", "a".repeat(15000))], { signal, onReject: code => rejected.push(code) });
  assert.equal(result[0].content, "abc"); assert.equal(result[0].truncated, false);
  assert.equal(result[1].content.length, 12000); assert.equal(result[1].truncated, true);
  assert.deepEqual(rejected, []);
});

test("cancelling a pending file read prevents it from returning attachments for a different conversation", async () => {
  let finish; const controller = new AbortController();
  const pending = readAttachments([{ name: "pending.txt", size: 10, text: () => new Promise(resolve => { finish = resolve; }) }], { signal: controller.signal, onReject: () => assert.fail("cancellation reported as a file error") });
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  finish("late file text");
  await new Promise(resolve => setImmediate(resolve));
});

test("unsupported, binary and oversized files are rejected without starting unnecessary reads", async () => {
  let read = false; const rejected = [];
  const result = await readAttachments([{ name: "large.txt", size: 100001, text: async () => { read = true; return "x"; } }, file("image.png", "png"), file("binary.txt", "\u0000bytes")], { signal: new AbortController().signal, onReject: code => rejected.push(code) });
  assert.equal(read, false); assert.deepEqual(result, []);
  assert.deepEqual(rejected, ["file_too_large", "unsupported_file", "binary_file"]);
});
