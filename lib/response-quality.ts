// Copyright © 2026 Alen Pepa
import { codeFences } from "./code-fences.ts";
import type { KnowledgeExcerpt } from "./knowledge-library.ts";
export type ReviewStatus = "standard" | "reviewed" | "skipped_context" | "skipped_length" | "review_incomplete" | "review_failed";
export type ResponseQuality = { review: ReviewStatus; passes: 1 | 2; unknownCitations: string[]; unfinishedCodeBlocks: number; arithmeticExpression?: string };
export function checkResponseQuality(text: string, knowledge: KnowledgeExcerpt[], review: ReviewStatus = "standard", passes: 1 | 2 = 1, arithmeticExpression?: string): ResponseQuality {
  const fences = codeFences(text); let prose = "", cursor = 0;
  for (const fence of fences) { prose += text.slice(cursor, fence.start); cursor = fence.end; } prose += text.slice(cursor);
  const known = new Set(knowledge.map(source => source.reference)), references = [...new Set([...prose.matchAll(/\[(K\d{1,3})\]/g)].map(match => match[1]))];
  return { review, passes, unknownCitations: references.filter(reference => !known.has(reference)).slice(0, 8), unfinishedCodeBlocks: Math.min(20, fences.filter(fence => !fence.closed).length), ...(arithmeticExpression && arithmeticExpression.length <= 240 ? { arithmeticExpression } : {}) };
}
export function restoreResponseQuality(value: unknown): ResponseQuality | undefined {
  if (!value || typeof value !== "object") return; const item = value as Record<string, unknown>;
  if (!["standard", "reviewed", "skipped_context", "skipped_length", "review_incomplete", "review_failed"].includes(String(item.review)) || item.passes !== 1 && item.passes !== 2 || !Array.isArray(item.unknownCitations) || item.unknownCitations.length > 8 || !item.unknownCitations.every(value => typeof value === "string" && /^K\d{1,3}$/.test(value)) || !Number.isInteger(item.unfinishedCodeBlocks) || Number(item.unfinishedCodeBlocks) < 0 || Number(item.unfinishedCodeBlocks) > 20) return;
  return { review: item.review as ReviewStatus, passes: item.passes, unknownCitations: [...new Set(item.unknownCitations as string[])], unfinishedCodeBlocks: Number(item.unfinishedCodeBlocks), ...(typeof item.arithmeticExpression === "string" && item.arithmeticExpression.length <= 240 ? { arithmeticExpression: item.arithmeticExpression } : {}) };
}
