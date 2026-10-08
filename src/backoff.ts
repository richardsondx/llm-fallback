/** Delay computation with AWS-style full jitter. */
import type { BackoffStrategy, ResolvedRetryPolicy } from "./types.js";

export function resolveRetryPolicy(policy: {
  attempts?: number;
  backoff?: BackoffStrategy;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
} = {}): ResolvedRetryPolicy {
  return {
    attempts: policy.attempts ?? 3,
    backoff: policy.backoff ?? "exponential",
    baseDelayMs: policy.baseDelayMs ?? 500,
    maxDelayMs: policy.maxDelayMs ?? 10_000,
    jitter: policy.jitter ?? true
  };
}

/**
 * Delay before the next attempt. `attempt` is 1-based (the attempt that
 * just failed). With jitter enabled this returns a value in
 * [0, min(cap, computed)] using full jitter.
 */
export function computeDelay(
  attempt: number,
  policy: ResolvedRetryPolicy,
  random: () => number = Math.random
): number {
  let base: number;
  if (typeof policy.backoff === "function") {
    base = Math.max(0, policy.backoff(attempt));
  } else if (policy.backoff === "linear") {
    base = policy.baseDelayMs * attempt;
  } else if (policy.backoff === "constant") {
    base = policy.baseDelayMs;
  } else {
    base = policy.baseDelayMs * 2 ** (attempt - 1);
  }
  const capped = Math.min(base, policy.maxDelayMs);
  if (!policy.jitter) return Math.round(capped);
  return Math.round(random() * capped);
}

/** Sleep that rejects early if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortedError());
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortedError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}
