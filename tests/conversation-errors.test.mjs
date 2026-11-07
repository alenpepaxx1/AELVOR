// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { asError, errorMessage } from "../lib/errors.ts";
import { conversationError } from "../lib/conversation-errors.ts";
import { aborted, abortable } from "../lib/conversation.ts";

test("model download and readiness failures have specific English and German recovery messages", () => {
  for (const locale of ["en", "de"]) {
    const codes = ["model_download_http_404", "model_download_http_403", "model_download_metadata", "model_download_chat_config", "model_download_size", "model_response_test_empty", "model_response_test_stream", "model_response_test_metadata", "model_download_timeout", "model_download_cache_unavailable"];
    const messages = codes.map(code => conversationError(code, locale));
    assert.equal(new Set(messages).size, codes.length);
    assert.ok(messages.every(message => !message.includes("model_download")));
  }
  assert.match(conversationError("model_download_size", "en"), /byte count/);
  assert.match(conversationError("model_response_test_timeout", "de"), /Antworttest/);
});

test("SDK strings and plain error objects keep the actual failure category", () => {
  assert.equal(errorMessage("GPU buffer allocation failed"), "GPU buffer allocation failed");
  assert.equal(asError({ message: "Failed to fetch model" }).message, "Failed to fetch model");
  assert.match(conversationError(asError("Error: WebGPU buffer allocation failed").message, "en"), /out of resources/);
  assert.match(conversationError("webgpu_unavailable", "de"), /kompatibles WebGPU/);
  assert.match(conversationError("Failed to fetch model", "en"), /downloaded or cached/);
  assert.match(conversationError("conversation_input_too_long", "en"), /Shorten.*custom instructions/);
});

test("already-cancelled operations still handle a pending promise rejection", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(abortable(Promise.reject(Error("late failure")), controller.signal), error => error.name === "AbortError");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted().name, "AbortError");
});
