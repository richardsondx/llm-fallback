/**
 * LangChain adapter.
 *
 * Wraps an ordered list of runnables (or anything with .invoke) so a call
 * retries and fails over across them with the standard error taxonomy:
 *
 *   import { withFallbackRunnable } from "fallback-llm/adapters/langchain";
 *
 *   const chain = withFallbackRunnable(
 *     [
 *       { name: "openai", invoke: (input) => openaiChain.invoke(input) },
 *       { name: "anthropic", invoke: (input) => anthropicChain.invoke(input) }
 *     ],
 *     { retry: { attempts: 2 } }
 *   );
 *   await chain.invoke("Hello");
 *
 * "@langchain/core" is an optional peer dependency and is only used as a
 * type here; nothing is required at runtime.
 */
import { withFallback } from "../fallback.js";
import type { FallbackOptions, Provider } from "../types.js";

export interface InvokeLike<I = unknown, O = unknown> {
  name?: string;
  invoke: (input: I) => Promise<O>;
}

export interface FallbackRunnable<I = unknown, O = unknown> {
  name: string;
  invoke: (input: I) => Promise<O>;
}

export function withFallbackRunnable<I = unknown, O = unknown>(
  runnables: Array<InvokeLike<I, O>>,
  options: FallbackOptions = {}
): FallbackRunnable<I, O> {
  if (runnables.length === 0) {
    throw new Error("fallback-llm: runnables must not be empty.");
  }
  const providers: Provider[] = runnables.map((r, i) => ({
    name: r.name ?? `runnable-${i + 1}`
  }));
  return {
    name: "fallback-runnable",
    invoke: (input: I): Promise<O> =>
      withFallback(
        providers,
        (provider) => {
          const idx = providers.indexOf(provider);
          const runnable = runnables[idx];
          if (!runnable) throw new Error("unreachable: runnable missing");
          return runnable.invoke(input);
        },
        options
      )
  };
}
