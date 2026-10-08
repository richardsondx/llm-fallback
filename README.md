# llm-fallback

**Your LLM provider will go down. Your app shouldn't.**

`llm-fallback` is a tiny, provider-agnostic retry + failover wrapper for LLM calls. It classifies errors correctly (retry the transient, fail over the provider-level, never retry the fatal), backs off with jitter, breaks circuits per provider, and passes streams through untouched. Zero dependencies.

```ts
import { withFallback } from "llm-fallback";

const answer = await withFallback(
  [{ name: "openai" }, { name: "anthropic" }, { name: "openrouter" }],
  (provider) => callMyModel(provider, prompt),
  { retry: { attempts: 3 } }
);
```

## Why this exists

Every production LLM app hand-rolls retry-with-backoff and provider failover, and the naive version has two bugs: it wraps everything in try/catch (which **breaks streaming** and **retries fatal errors like 401s**), and it drifts with every SDK version. This library is the 20-line abstraction done once, correctly, with no SDK dependency.

## The error taxonomy

Every failure is classified before anything else happens:

| Class | Meaning | Examples |
|---|---|---|
| `retry` | Transient: retry the **same** provider | 429 rate limit, 500/502/503/504, 408, timeouts, ECONNRESET, `overloaded_error` |
| `failover` | Provider-level: move to the **next** provider now | 429 with `insufficient_quota` (retrying the same key is pointless), `model_not_found` |
| `fatal` | The request is bad: throw **immediately** | 400, 401, 403, 404, 422, `invalid_api_key`, `invalid_request_error` |

Unknown errors are treated as transient (attempts are bounded, failover follows). Override any decision with `shouldClassify`.

## Install

```bash
npm install llm-fallback
```

## Usage

### Basic

```ts
import { withFallback } from "llm-fallback";

const text = await withFallback(
  [{ name: "openai", model: "gpt-4o" }, { name: "anthropic", model: "claude-sonnet-4-5" }],
  async (provider) => {
    if (provider.name === "openai") return openai.chat.completions.create({ ... });
    return anthropic.messages.create({ ... });
  },
  {
    retry: { attempts: 3, backoff: "exponential", baseDelayMs: 500, maxDelayMs: 10_000 },
    onRetry: ({ provider, attempt, delayMs }) =>
      console.log(`retry ${attempt} on ${provider.name} in ${delayMs}ms`),
    onFallback: ({ from, to }) =>
      console.log(`failing over from ${from.name} to ${to?.name}`),
  }
);
```

### Reusable caller (keeps circuit-breaker state across calls)

```ts
import { createFallbackCaller } from "llm-fallback";

const ask = createFallbackCaller(providers, options);
const answer = await ask((p) => myCall(p, prompt));
```

Circuit breakers open after 5 consecutive provider-level failures (configurable) and half-open after 60s. Fatal request errors never trip the breaker.

### Streaming

Streams pass through untouched: only the initial call is protected, so there is no buffering and no latency cost. Mid-stream failures cannot be transparently failed over (bytes already left), but you can observe them:

```ts
import { withFallback, observeStream } from "llm-fallback";

const stream = await withFallback(providers, (p) => startStream(p), options);
const observed = observeStream(stream, {
  onError: (e) => metrics.increment("stream.error"),
});
```

For async-iterable stream shapes (Anthropic/OpenAI SDKs), use `observeAsyncIterable`.

### Vercel AI SDK

```ts
import { wrapLanguageModel } from "ai";
import { fallbackMiddleware } from "llm-fallback/adapters/ai-sdk";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: fallbackMiddleware(
    [{ name: "openai" }, { name: "anthropic" }],
    { retry: { attempts: 2 } }
  ),
});
```

### LangChain

```ts
import { withFallbackRunnable } from "llm-fallback/adapters/langchain";

const chain = withFallbackRunnable(
  [
    { name: "openai", invoke: (input) => openaiChain.invoke(input) },
    { name: "anthropic", invoke: (input) => anthropicChain.invoke(input) },
  ],
  { retry: { attempts: 2 } }
);
await chain.invoke("Hello");
```

## API

- `withFallback(providers, call, options?)` — run `call(provider)` against providers in order.
- `createFallbackCaller(providers, options?)` — bound caller with persistent circuit state.
- `classifyError(error)` — the taxonomy as a function, exported for reuse and testing.
- `observeStream(stream, hooks?)`, `observeAsyncIterable(iterable, hooks?)` — stream observation.
- `computeDelay(attempt, policy)`, `CircuitBreaker` — primitives, exported for embedding.

Options: `retry` (attempts, backoff strategy or function, base/max delay, jitter), `circuitBreaker` (threshold, reset timeout, or `false` to disable), `shouldClassify`, `onRetry`, `onFallback`, `onExhausted`, `signal` (AbortSignal).

## FAQ

**Why not LiteLLM / Portkey?** Those are deployable gateway proxies: separate infrastructure to run. This is an in-process library: one import, no infra.

**Why not the AI-SDK-scoped retry libs?** They inherit version-drift fragility with every SDK major. This is framework-agnostic by design.

**Does it work with raw fetch?** Yes. If your call throws something with a `status`, `code`, or `type`, the taxonomy handles it. Anything else gets the transient default.

## License

MIT
