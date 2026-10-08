/**
 * withFallback: run an async LLM call against an ordered provider list with
 * correct error classification, backoff, per-provider circuit breaking, and
 * streaming passthrough.
 *
 * The `call` function receives each provider in turn and may return anything,
 * including a stream. Streams pass through untouched: only the initial call
 * is protected. Mid-stream failures cannot be transparently failed over
 * (bytes already left the building); use observeStream/observeAsyncIterable
 * from "./stream.js" if you want error hooks on streams.
 *
 * Circuit-breaker state is per withFallback call. For state that persists
 * across calls (the normal production setup), use createFallbackCaller.
 */
import { classifyError } from "./classify.js";
import {
  CircuitBreaker,
  resolveCircuitBreakerPolicy
} from "./circuit.js";
import { computeDelay, resolveRetryPolicy, sleep } from "./backoff.js";
import type {
  ErrorClass,
  FallbackOptions,
  Provider,
  ResolvedCircuitBreakerPolicy,
  ResolvedRetryPolicy
} from "./types.js";

interface RunContext {
  retry: ResolvedRetryPolicy;
  breakerEnabled: boolean;
  breakerPolicy: ResolvedCircuitBreakerPolicy;
  breakers: Map<string, CircuitBreaker>;
  options: FallbackOptions;
  startedAt: number;
}

export async function withFallback<T>(
  providers: Provider[],
  call: (provider: Provider) => Promise<T>,
  options: FallbackOptions = {}
): Promise<T> {
  return runWithBreakers(providers, call, options, new Map());
}

async function runWithBreakers<T>(
  providers: Provider[],
  call: (provider: Provider) => Promise<T>,
  options: FallbackOptions,
  breakers: Map<string, CircuitBreaker>
): Promise<T> {
  if (providers.length === 0) {
    throw new Error("fallback-llm: providers must not be empty.");
  }
  const ctx: RunContext = {
    retry: resolveRetryPolicy(options.retry),
    breakerEnabled: options.circuitBreaker !== false,
    breakerPolicy: resolveCircuitBreakerPolicy(
      options.circuitBreaker === false ? {} : (options.circuitBreaker ?? {})
    ),
    breakers,
    options,
    startedAt: Date.now()
  };

  const attempted: string[] = [];
  let lastError: unknown = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i] as Provider;
    if (ctx.breakerEnabled && breakerFor(ctx, provider.name).isOpen()) {
      continue; // circuit open: skip without counting an attempt
    }
    attempted.push(provider.name);

    for (let attempt = 1; attempt <= ctx.retry.attempts; attempt++) {
      throwIfAborted(options.signal);
      try {
        const result = await call(provider);
        if (ctx.breakerEnabled) breakerFor(ctx, provider.name).recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        const errorClass = classify(error, options);
        const elapsedMs = Date.now() - ctx.startedAt;

        if (errorClass === "fatal") {
          throw error;
        }

        if (errorClass === "failover" || attempt >= ctx.retry.attempts) {
          if (ctx.breakerEnabled) breakerFor(ctx, provider.name).recordFailure();
          const next = nextAvailable(ctx, providers, i + 1);
          options.onFallback?.({
            from: provider,
            to: next,
            error,
            elapsedMs
          });
          break; // move to the next provider
        }

        const delayMs = computeDelay(attempt, ctx.retry);
        options.onRetry?.({
          provider,
          attempt,
          maxAttempts: ctx.retry.attempts,
          error,
          errorClass,
          delayMs,
          elapsedMs
        });
        await sleep(delayMs, options.signal);
      }
    }
  }

  const elapsedMs = Date.now() - ctx.startedAt;
  options.onExhausted?.({ providersAttempted: attempted, lastError, elapsedMs });
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `fallback-llm: all providers exhausted (${attempted.join(", ")}).`
      );
}

function classify(error: unknown, options: FallbackOptions): ErrorClass {
  return options.shouldClassify?.(error) ?? classifyError(error);
}

function breakerFor(ctx: RunContext, name: string): CircuitBreaker {
  let b = ctx.breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(ctx.breakerPolicy);
    ctx.breakers.set(name, b);
  }
  return b;
}

function nextAvailable(
  ctx: RunContext,
  providers: Provider[],
  fromIndex: number
): Provider | null {
  for (let i = fromIndex; i < providers.length; i++) {
    const p = providers[i] as Provider;
    const b = ctx.breakers.get(p.name);
    if (!ctx.breakerEnabled || !b || !b.isOpen()) return p;
  }
  return null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Bind a provider list and options once, get a reusable caller back.
 * Circuit-breaker state persists across calls made through the same caller,
 * which is what you want in a long-lived service.
 *
 *   const ask = createFallbackCaller(providers, options);
 *   const answer = await ask((p) => openai.chat(p, prompt));
 */
export function createFallbackCaller(
  providers: Provider[],
  options: FallbackOptions = {}
): <T>(call: (provider: Provider) => Promise<T>) => Promise<T> {
  const breakers = new Map<string, CircuitBreaker>();
  return <T>(call: (provider: Provider) => Promise<T>) =>
    runWithBreakers(providers, call, options, breakers);
}
