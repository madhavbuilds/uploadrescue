import { UploadAbortedError } from "./errors";

/** Throws an abort error if the signal is already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new UploadAbortedError();
  }
}

/**
 * Creates an AbortController that aborts whenever any parent signal aborts.
 * Call `dispose()` to detach listeners once the operation settles.
 */
export function linkedAbortController(...parents: Array<AbortSignal | undefined>): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  for (const parent of parents) {
    if (!parent) continue;
    if (parent.aborted) {
      controller.abort(parent.reason);
      break;
    }
    const onAbort = () => controller.abort(parent.reason);
    parent.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => parent.removeEventListener("abort", onAbort));
  }
  return { controller, dispose: () => cleanups.forEach((fn) => fn()) };
}

/**
 * Rejects as soon as the signal aborts, even if `promise` never settles
 * (e.g. an upload function that ignores its signal).
 */
export function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new UploadAbortedError(),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : new UploadAbortedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Resolves after `ms`, or rejects early if the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new UploadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new UploadAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Random identifier; uses `crypto.randomUUID` when available. */
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
