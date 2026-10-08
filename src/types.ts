/**
 * Public types for llm-fallback.
 *
 * The library is intentionally provider-agnostic: a "provider" is just a
 * labeled entry, and your `call` function decides what to do with it. This
 * keeps the core free of any SDK dependency.
 */

/** How the library should treat a failed call. */
export type ErrorClass =
  /** Transient problem: retry the SAME provider (rate limit, 5xx, timeout). */
  | "retry"
  /** Provider-level problem: move to the NEXT provider now (quota exhausted, circuit open). */
  | "failover"
  /** The request itself is bad: throw immediately, no retry, no failover. */
  | "fatal";

/** A provider entry. Add any metadata you need (model id, base URL, key ref). */
export interface Provider {
  name: string;
  [key: string]: unknown;
}

export type BackoffStrategy =
  | "exponential"
  | "linear"
  | "constant"
  | ((attempt: number) => number);

export interface RetryPolicy {
  /** Attempts per provider before failing over. Default 3. */
  attempts?: number;
  /** Backoff shape between attempts. Default "exponential". */
  backoff?: BackoffStrategy;
  /** Base delay in ms for computed strategies. Default 500. */
  baseDelayMs?: number;
  /** Hard cap for any single delay in ms. Default 10000. */
  maxDelayMs?: number;
  /** Full jitter on computed delays (AWS-style). Default true. */
  jitter?: boolean;
}

export interface CircuitBreakerPolicy {
  /** Consecutive provider-level failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long an open circuit stays open before a half-open probe. Default 60000. */
  resetTimeoutMs?: number;
}

export interface RetryInfo {
  provider: Provider;
  attempt: number;
  maxAttempts: number;
  error: unknown;
  errorClass: ErrorClass;
  /** How long we will wait before the next attempt, in ms. */
  delayMs: number;
  /** ms since withFallback started. */
  elapsedMs: number;
}

export interface FallbackInfo {
  from: Provider;
  to: Provider | null;
  /** The error that exhausted the previous provider. */
  error: unknown;
  /** ms since withFallback started. */
  elapsedMs: number;
}

export interface ExhaustedInfo {
  providersAttempted: string[];
  lastError: unknown;
  /** ms since withFallback started. */
  elapsedMs: number;
}

export interface FallbackOptions {
  retry?: RetryPolicy;
  /** Set to false to disable the per-provider circuit breaker. Default enabled. */
  circuitBreaker?: CircuitBreakerPolicy | false;
  /**
   * Override the built-in error taxonomy. Return an ErrorClass to decide,
   * or undefined to fall back to the default classification.
   */
  shouldClassify?: (error: unknown) => ErrorClass | undefined;
  onRetry?: (info: RetryInfo) => void;
  onFallback?: (info: FallbackInfo) => void;
  onExhausted?: (info: ExhaustedInfo) => void;
  signal?: AbortSignal;
}

/** Resolved retry settings with every default applied. */
export interface ResolvedRetryPolicy {
  attempts: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

/** Resolved circuit breaker settings with every default applied. */
export interface ResolvedCircuitBreakerPolicy {
  failureThreshold: number;
  resetTimeoutMs: number;
}
