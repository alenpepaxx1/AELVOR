// Copyright © 2026 Alen Pepa
import { aborted, abortable } from "./conversation.ts";

export type TextFile = { name: string; size: number; text: () => Promise<string> };
export async function readAttachments(files: TextFile[], options: { signal: AbortSignal; onReject: (code: string) => void }) {
  const result: { name: string; content: string; truncated: boolean }[] = [];
  for (const file of files.slice(0, 3)) {
    if (options.signal.aborted) throw aborted();
    if (file.size > 100_000) { options.onReject("file_too_large"); continue; }
    if (!/\.(txt|log|json|csv|tsv|py|js|ts|tsx|jsx|md|sh|yml|yaml|conf|ini|xml|java|go|c|cpp|rs|html|css|sql|ps1)$/i.test(file.name)) { options.onReject("unsupported_file"); continue; }
    let content: string;
    try { content = await abortable(file.text(), options.signal); }
    catch { if (options.signal.aborted) throw aborted(); options.onReject("file_read_failed"); continue; }
    if (content.includes("\u0000")) { options.onReject("binary_file"); continue; }
    result.push({ name: file.name, content: content.slice(0, 12000), truncated: content.length > 12000 });
  }
  if (options.signal.aborted) throw aborted();
  return result;
}
