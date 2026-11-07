// Copyright © 2026 Alen Pepa
import { aborted } from "./conversation.ts";

type Waiter = { enter: () => void; reject: (error: Error) => void; cancel: () => void; signal?: AbortSignal };

export class AsyncMutex {
  private locked = false;
  private closed: Error | null = null;
  private queue: Waiter[] = [];
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(this.closed);
    if (signal?.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal, reject,
        cancel: () => { this.queue = this.queue.filter(item => item !== waiter); reject(aborted()); },
        enter: () => {
          signal?.removeEventListener("abort", waiter.cancel); this.locked = true;
          let released = false;
          resolve(() => { if (!released) { released = true; this.locked = false; this.next(); } });
        },
      };
      if (!this.locked) waiter.enter();
      else { this.queue.push(waiter); signal?.addEventListener("abort", waiter.cancel, { once: true }); }
    });
  }
  private next() { if (!this.closed) this.queue.shift()?.enter(); }
  dispose(error = new Error("model_not_ready")) {
    this.closed = error;
    for (const waiter of this.queue.splice(0)) { waiter.signal?.removeEventListener("abort", waiter.cancel); waiter.reject(error); }
  }
}
