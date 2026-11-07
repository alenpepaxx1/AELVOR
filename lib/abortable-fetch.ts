// Copyright © 2026 Alen Pepa
export function discardResponse(response: Response): void {
  try { void response.body?.cancel().catch(() => {}); } catch { /* Cleanup must not hide the original result. */ }
}

// Some transports do not reject their promise when the supplied signal aborts.
// Settle the caller independently and release any response that arrives late.
export async function fetchWithAbort(input: RequestInfo | URL, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  const aborted = () => new DOMException("Aborted", "AbortError");
  if (signal.aborted) throw aborted();
  const pending = fetcher(input, { ...init, signal });
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener("abort", cancel); reject(aborted()); };
    signal.addEventListener("abort", cancel, { once: true });
    pending.then(response => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) { discardResponse(response); reject(aborted()); }
      else resolve(response);
    }, error => { signal.removeEventListener("abort", cancel); reject(signal.aborted ? aborted() : error); });
    if (signal.aborted) cancel();
  });
}
