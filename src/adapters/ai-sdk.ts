/**
 * Vercel AI SDK adapter.
 *
 * Wraps a language model so every generate/stream call gets retry +
 * failover across your provider list. Use with wrapLanguageModel:
 *
 *   import { wrapLanguageModel } from "ai";
 *   import { fallbackMiddleware } from "fallback-llm/adapters/ai-sdk";
 *
 *   const model = wrapLanguageModel({
 *     model: openai("gpt-4o"),
 *     middleware: fallbackMiddleware(
 *       [{ name: "openai" }, { name: "anthropic" }, { name: "openrouter" }],
 *       { retry: { attempts: 2 } }
 *     )
 *   });
 *
 * The "ai" package is an optional peer dependency and is only imported as
 * a type here; nothing is required at runtime.
 */
import { withFallback } from "../fallback.js";
import type { FallbackOptions, Provider } from "../types.js";

export interface AISDKMiddleware {
  specificationVersion: "v2";
  wrapGenerate?: <T>(args: {
    doGenerate: () => Promise<T>;
    model: unknown;
  }) => Promise<T>;
  wrapStream?: <T>(args: {
    doStream: () => Promise<T>;
    model: unknown;
  }) => Promise<T>;
}

export function fallbackMiddleware(
  providers: Provider[],
  options: FallbackOptions = {}
): AISDKMiddleware {
  return {
    specificationVersion: "v2",
    wrapGenerate: ({ doGenerate }) =>
      withFallback(providers, () => doGenerate(), options),
    wrapStream: ({ doStream }) =>
      withFallback(providers, () => doStream(), options)
  };
}
