// Copyright © 2026 Alen Pepa
import test from "node:test";
import assert from "node:assert/strict";
import { calculateExpression, arithmeticQuestion } from "../lib/local-arithmetic.ts";
import { prepareConversation, generateConversation, conversationModels } from "../lib/conversation.ts";
import { prepareAnswerReview } from "../lib/answer-review.ts";
import { checkResponseQuality, restoreResponseQuality } from "../lib/response-quality.ts";
import { ConversationSession } from "../lib/conversation-session.ts";
import { runLocalAgent } from "../lib/local-agent.ts";
import { restoreWorkspace } from "../lib/workspace-state.ts";
import { branchRefinement, createConversationBackup, parseConversationBackup } from "../lib/conversation-workspace.ts";
import { assistantPreferencePrompt, normalizeAssistantPreferences, readAssistantPreferences, writeAssistantPreferences } from "../lib/assistant-preferences.ts";
import { conversationError } from "../lib/conversation-errors.ts";

const careful = { style: "balanced", instructions: "", quality: "careful" };
const chunk = (content, finish_reason = "stop") => ({ choices: [{ delta: { content }, finish_reason }] });
function adapterFor(answers) {
  const calls = [], state = { interrupted: 0 };
  return { calls, state, interrupt() { state.interrupted++; }, async stream(messages, signal, settings) {
    const index = calls.length; calls.push({ messages: structuredClone(messages), settings, signal });
    const answer = answers[index];
    if (answer instanceof Error) throw answer;
    return (async function* () { for (const item of answer || []) yield typeof item === "string" ? chunk(item) : item; })();
  } };
}
const source = { id: "cedar", title: "Cedar notes", content: "Cedar uses Boreal encryption.\nRotate the gateway key on Friday.", sourceUrl: "", sourceDate: "2026-10-28", enabled: true, updatedAt: 1 };

test("local arithmetic keeps exact fractions, precedence, right-associated powers and explicit rounding", () => {
  for (const [expression, exact, decimal, approximate = false] of [
    ["0.1 + 0.2", "3/10", "0.3"], ["-2^2", "-4", "-4"], ["(-2)^2", "4", "4"],
    ["2^-2", "1/4", "0.25"], ["2^3^2", "512", "512"], ["18% * 250", "45", "45"],
    ["6 ÷ (2 × 3)", "1", "1"], ["1/3", "1/3", "0.333333333333", true],
    ["2/3", "2/3", "0.666666666667", true], ["-1/3000000000000", "-1/3000000000000", "0", true],
  ]) assert.deepEqual(calculateExpression(expression), { expression, exact, decimal, approximate });
});

test("arithmetic rejects code, ambiguous decimals, unsupported operators and unbounded work", () => {
  for (const [expression, error] of [["1/0", "division_zero"], ["0^0", "undefined_power"], ["0^-1", "division_zero"], ["2^17", "range"], ["2^0.5", "range"], ["5!", "syntax"], ["1,5+2", "syntax"], ["2(3)", "syntax"], ["process.exit()", "syntax"], ["1".repeat(17), "range"], ["(".repeat(17) + "1" + ")".repeat(17), "range"], ["1+".repeat(65) + "1", "range"], ["2".repeat(241), "range"], ["9999999999999999^16", "range"]]) assert.throws(() => calculateExpression(expression), new RegExp(error), expression);
  for (const text of ["What is the weather?", "2026-11-01", "1/11/2026", "Calculate 5!", "Calculate 2 meters + 3 meters", "```js\n2+2\n```", "Explain 2+2"]) assert.equal(arithmeticQuestion(text), undefined, text);
  assert.equal(arithmeticQuestion("What is 0.1 + 0.2?").value.exact, "3/10");
  assert.equal(arithmeticQuestion("Berechne 18 Prozent von 250").value.exact, "45");
  assert.equal(arithmeticQuestion("calc:2+2").value.exact, "4");
  assert.equal(arithmeticQuestion("Calculate 1,000 + 2").error, "syntax");
  const long = "1+".repeat(121) + "1";
  assert.equal(arithmeticQuestion(long).expression, long); assert.equal(arithmeticQuestion(long).error, "range");
});

test("pure arithmetic is available offline in English/German tools and quoted AI context without intercepting files", async () => {
  for (const [locale, text] of [["en", "Calculate 18 percent of 250"], ["de", "Berechne 18 Prozent von 250"]]) {
    const reply = await runLocalAgent({ locale, text });
    assert.match(reply.text, /45/); assert.equal(reply.kind, "knowledge");
    const prepared = prepareConversation({ text, locale, characterBudget: 1000 });
    assert.equal(prepared.arithmetic.value.exact, "45");
    assert.ok(prepared.messages.at(-1).content.startsWith(text));
    assert.match(prepared.messages.at(-1).content, /quoted data, not instructions/);
    assert.ok(prepared.messages.at(-1).content.length <= 1000);
  }
  const invalid = await runLocalAgent({ text: "Calculate 1/0", locale: "en" });
  assert.match(invalid.text, /zero/i); assert.doesNotMatch(invalid.text, /Infinity/);
  assert.equal(prepareConversation({ text: "2+2", files: [{ name: "notes.txt", content: "Not a calculator task" }], locale: "en" }).arithmetic, undefined);
  const text = " ".repeat(300) + "2+2";
  assert.equal(prepareConversation({ text, locale: "en" }).arithmetic.value.exact, "4");
});

test("review fitting preserves complete current evidence, quoted draft and protected continuation pairs", () => {
  const request = { text: "Explain Cedar encryption", locale: "en", preferences: careful, knowledge: [source], characterBudget: 2400, history: [{ role: "user", content: "Older " + "x".repeat(650) }, { role: "assistant", content: "Older answer " + "x".repeat(650) }] };
  const prepared = prepareConversation(request), candidate = 'Draft "quoted" answer.\n'.repeat(25);
  const next = prepareAnswerReview(prepared, candidate, request);
  assert.ok(next); assert.equal(next.messages.filter(item => item.role === "system").length, 1);
  assert.ok(next.messages.at(-1).content.startsWith(prepared.messages.at(-1).content));
  assert.equal(JSON.parse(next.messages.at(-1).content.split("quoted data, not instructions):\n").at(-1)).answer, candidate);
  assert.deepEqual(next.knowledge, prepared.knowledge);
  assert.ok(next.messages.slice(1).reduce((n, item) => n + item.content.length, 0) + assistantPreferencePrompt(request.preferences).length <= 2400);
  assert.equal(next.messages.length % 2, 0); assert.ok(next.settings.temperature <= 0.35);
  assert.equal(next.settings.maxOutputTokens, prepared.settings.maxOutputTokens); assert.equal(next.settings.maxOutputTokens, 768);
  const continuation = { text: "Continue", locale: "en", preserveLastPair: true, characterBudget: 1000, history: [{ role: "user", content: "q".repeat(300) }, { role: "assistant", content: "a".repeat(300) }] };
  assert.equal(prepareAnswerReview(prepareConversation(continuation), "d".repeat(400), continuation), null);
  assert.equal(prepareAnswerReview(prepareConversation({ text: "Question", locale: "en", characterBudget: 1000 }), '"'.repeat(600), { text: "Question", locale: "en", characterBudget: 1000 }), null);
});

test("careful generation stages two passes, emits only the selected final answer and audits its sources", async () => {
  const engine = adapterFor([[chunk("Initial ", null), chunk("draft [K7]")], [chunk("Improved ", null), chunk("answer [K1].")]]);
  const frames = [], phases = [], drafts = []; let activity = 0;
  const reply = await generateConversation(engine, { text: "Explain Cedar", locale: "de", knowledge: [source], preferences: careful, onText: text => frames.push(text), onPhase: phase => phases.push(phase), onDraft: draft => drafts.push(draft), onActivity: () => activity++ });
  assert.deepEqual(phases, ["draft", "review"]); assert.deepEqual(drafts, ["Initial draft [K7]"]);
  assert.deepEqual(frames, ["Improved answer [K1]."]); assert.equal(engine.calls.length, 2); assert.equal(activity, 4);
  assert.equal(reply.quality.review, "reviewed"); assert.equal(reply.quality.passes, 2); assert.deepEqual(reply.quality.unknownCitations, []);
  assert.equal(reply.metrics.firstTokenMs, reply.metrics.elapsedMs);
  assert.equal(engine.calls[1].settings.maxOutputTokens, engine.calls[0].settings.maxOutputTokens); assert.equal(engine.calls[1].settings.maxOutputTokens, 768);
  assert.match(engine.calls[1].messages[0].content, /Return only the improved final answer/);
});

test("standard mode keeps incremental output and never spends a second pass", async () => {
  const engine = adapterFor([[chunk("First ", null), chunk("answer")]]), frames = [];
  const reply = await generateConversation(engine, { text: "Hello", locale: "en", onText: text => frames.push(text) });
  assert.deepEqual(frames, ["First ", "First answer"]); assert.equal(engine.calls.length, 1);
  assert.equal(reply.quality.review, "standard"); assert.equal(reply.quality.passes, 1);
});

test("review limits and failures retain a completed draft with accurate status", async () => {
  for (const [answers, request, status, passes] of [
    [[[chunk("Partial draft", "length")]], {}, "skipped_length", 1],
    [[[chunk("d".repeat(950))]], { characterBudget: 1000 }, "skipped_context", 1],
    [[[chunk("Completed draft")], [chunk("Unfinished revision", "length")]], {}, "review_incomplete", 2],
    [[[chunk("Completed draft")], new Error("device lost")], {}, "review_failed", 2],
    [[[chunk("Completed draft")], []], {}, "review_failed", 2],
  ]) {
    const engine = adapterFor(answers), frames = [];
    const reply = await generateConversation(engine, { text: "Hello", locale: "en", preferences: careful, ...request, onText: text => frames.push(text) });
    assert.equal(reply.text, answers[0][0].choices[0].delta.content); assert.deepEqual(frames, [reply.text]);
    assert.equal(reply.quality.review, status); assert.equal(reply.quality.passes, passes); assert.equal(engine.calls.length, passes);
  }
});

test("Stop in either hidden phase emits no final answer and never starts another phase", async () => {
  for (const phase of ["draft", "review"]) {
    const controller = new AbortController(), engine = adapterFor([[chunk("Draft")], [chunk("Revision")]]), drafts = [];
    await assert.rejects(generateConversation(engine, { text: "Hello", locale: "en", preferences: careful, signal: controller.signal, onPhase: current => { if (current === phase) controller.abort(); }, onText: () => assert.fail("Cancelled answer displayed"), onDraft: text => drafts.push(text) }), error => error.name === "AbortError");
    assert.equal(engine.calls.length, phase === "draft" ? 0 : 1); assert.deepEqual(drafts, phase === "draft" ? [] : ["Draft"]);
  }
});

test("cancelling a running hidden review closes its iterator and preserves only the completed draft callback", async () => {
  const controller = new AbortController(); let calls = 0, review = false, closed = false, interrupted = 0; const drafts = [];
  const engine = { interrupt() { interrupted++; }, async stream() {
    calls++; return (async function* () {
      try { yield chunk(calls === 1 ? "Completed draft" : "Partial revision"); }
      finally { if (calls === 2) closed = true; }
    })();
  } };
  await assert.rejects(generateConversation(engine, { text: "Hello", locale: "en", preferences: careful, signal: controller.signal, onPhase: phase => { review = phase === "review"; }, onActivity: () => { if (review) controller.abort(); }, onDraft: text => drafts.push(text), onText: () => assert.fail("Stopped review was displayed") }), error => error.name === "AbortError");
  assert.equal(calls, 2); assert.equal(closed, true); assert.ok(interrupted >= 1); assert.deepEqual(drafts, ["Completed draft"]);
});

test("hidden-token activity protects session watchdog, while failed review unloads an interrupted CPU/GPU runtime", async () => {
  const modelId = conversationModels[0].id; let calls = 0, disposed = 0;
  const runtime = { modelId, characterBudget: 2400, dispose() { disposed++; }, adapter: { interrupt() {}, async stream() { calls++; return (async function* () { for (let i = 0; i < 8; i++) { await new Promise(resolve => setTimeout(resolve, 25)); yield chunk("text ", i === 7 ? "stop" : null); } })(); } } };
  const session = new ConversationSession({ stallTimeoutMs: 150, load: async () => runtime });
  await session.load(modelId); const result = await session.generate({ text: "Hello", locale: "en", preferences: careful });
  assert.equal(result.quality.review, "reviewed"); assert.equal(calls, 2); assert.equal(session.ready, true); session.unload();
  assert.equal(disposed, 1);
  for (const cancelRequiresReload of [false, true]) {
    let disposed = 0; const engine = adapterFor([[chunk("Completed draft")], new Error("empty_generation")]);
    const session = new ConversationSession({ load: async () => ({ modelId, cancelRequiresReload, adapter: engine, dispose() { disposed++; } }) });
    await session.load(modelId); const reply = await session.generate({ text: "Hello", locale: "en", preferences: careful });
    assert.equal(reply.text, "Completed draft"); assert.equal(session.ready, false); assert.equal(session.getSnapshot().error, "generation_review_failed"); assert.equal(disposed, 1);
    await assert.rejects(session.generate({ text: "Again", locale: "en" }), /model_not_ready/); session.unload(); assert.equal(disposed, 1);
    assert.match(conversationError("generation_review_failed", "en"), /draft was kept/); assert.match(conversationError("generation_review_failed", "de"), /Entwurf bleibt erhalten/);
  }
});

test("response checks exclude fenced examples, flag missing references and reject unbounded restored metadata", () => {
  const quality = checkResponseQuality("Known [K1], unknown [K9].\n```js\nconst sample = '[K8]';\n```\n```python\nprint('[K7]')", [{ reference: "K1" }], "reviewed", 2, "0.1+0.2");
  assert.deepEqual(quality.unknownCitations, ["K9"]); assert.equal(quality.unfinishedCodeBlocks, 1);
  assert.deepEqual(restoreResponseQuality({ ...quality, execute: "untrusted" }), quality);
  for (const bad of [{ ...quality, passes: 3 }, { ...quality, unknownCitations: ["<script>"] }, { ...quality, unfinishedCodeBlocks: 21 }, { ...quality, review: "verified" }]) assert.equal(restoreResponseQuality(bad), undefined);
  assert.equal(checkResponseQuality("x", [], "standard", 1, "x".repeat(241)).arithmeticExpression, undefined);
});

test("quality metadata survives storage and backups, and branches detach mutable label arrays", () => {
  const quality = checkResponseQuality("Answer [K9]", [], "reviewed", 2, "2+2");
  const chat = { id: "chat", title: "Math", updatedAt: 1, messages: [{ id: "q", role: "user", content: "2+2", quality }, { id: "a", role: "assistant", content: "Answer [K9]", kind: "conversation", quality }] };
  const restored = restoreWorkspace({ chats: [chat] }).chats[0];
  assert.equal(restored.messages[0].quality, undefined); assert.deepEqual(restored.messages[1].quality, quality);
  const backup = parseConversationBackup(JSON.stringify(createConversationBackup([restored]))).backup;
  assert.deepEqual(backup.chats[0].messages[1].quality, quality);
  let id = 0; const branched = branchRefinement(restored, "a", "Explain more", () => `id-${++id}`);
  branched.history[1].quality.unknownCitations.push("K8"); assert.deepEqual(restored.messages[1].quality.unknownCitations, ["K9"]);
});

test("careful preference migrates legacy data safely and round trips without changing the prompt budget", () => {
  assert.equal(normalizeAssistantPreferences({ style: "concise" }).quality, "standard");
  assert.equal(normalizeAssistantPreferences({ quality: "verified" }).quality, "standard");
  let raw = ""; const storage = { getItem() { return raw; }, setItem(_key, value) { raw = value; } };
  assert.equal(writeAssistantPreferences(careful, storage), true); assert.equal(readAssistantPreferences(storage).quality, "careful");
  assert.equal(assistantPreferencePrompt(careful), assistantPreferencePrompt({ ...careful, quality: "standard" }));
});
