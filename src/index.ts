/**
 * fallback-llm: your LLM provider will go down. Your app shouldn't.
 *
 * Provider-agnostic retry + failover with correct error classification,
 * exponential backoff with jitter, per-provider circuit breaking, and
 * streaming passthrough. Zero dependencies.
 */
export { withFallback, createFallbackCaller } from "./fallback.js";
export { classifyError } from "./classify.js";
export { observeStream, observeAsyncIterable } from "./stream.js";
export type { StreamHooks } from "./stream.js";
export { computeDelay, resolveRetryPolicy } from "./backoff.js";
export { CircuitBreaker } from "./circuit.js";
export type {
  ErrorClass,
  Provider,
  BackoffStrategy,
  RetryPolicy,
  CircuitBreakerPolicy,
  RetryInfo,
  FallbackInfo,
  ExhaustedInfo,
  FallbackOptions,
  ResolvedRetryPolicy,
  ResolvedCircuitBreakerPolicy
} from "./types.js";
