import { describe, expect, it, vi } from "vitest";
import { withFallback, createFallbackCaller } from "../src/fallback.js";
import type { Provider } from "../src/types.js";

const FAST = { retry: { baseDelayMs: 1, jitter: false } };
const providers: Provider[] = [{ name: "a" }, { name: "b" }, { name: "c" }];

function err(status: number, message = "x") {
  return Object.assign(new Error(message), { status });
}

describe("withFallback", () => {
  it("returns the first success without retrying", async () => {
    const call = vi.fn(async () => "ok");
    const result = await withFallback(providers, call, FAST);
    expect(result).toBe("ok");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors on the same provider, then succeeds", async () => {
    let n = 0;
    const seen: string[] = [];
    const result = await withFallback(
      providers,
      async (p) => {
        seen.push(p.name);
        n++;
        if (n < 3) throw err(503, "overloaded");
        return "recovered";
      },
      FAST
    );
    expect(result).toBe("recovered");
    expect(seen).toEqual(["a", "a", "a"]);
  });

  it("fails over to the next provider after attempts are exhausted", async () => {
    const seen: string[] = [];
    const result = await withFallback(
      providers,
      async (p) => {
        seen.push(p.name);
        if (p.name !== "c") throw err(500, "server error");
        return "from-c";
      },
      { retry: { attempts: 2, baseDelayMs: 1, jitter: false } }
    );
    expect(result).toBe("from-c");
    expect(seen).toEqual(["a", "a", "b", "b", "c"]);
  });

  it("fails over immediately on quota exhaustion", async () => {
    const seen: string[] = [];
    const result = await withFallback(
      providers,
      async (p) => {
        seen.push(p.name);
        if (p.name === "a") {
          throw Object.assign(new Error("quota"), {
            status: 429,
            code: "insufficient_quota"
          });
        }
        return "from-b";
      },
      FAST
    );
    expect(result).toBe("from-b");
    expect(seen).toEqual(["a", "b"]);
  });

  it("throws fatal errors immediately without retry or failover", async () => {
    const call = vi.fn(async () => {
      throw err(401, "invalid key");
    });
    await expect(withFallback(providers, call, FAST)).rejects.toThrow(
      "invalid key"
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after all providers are exhausted", async () => {
    const onExhausted = vi.fn();
    await expect(
      withFallback(providers, async () => {
        throw err(503, "down");
      }, { ...FAST, onExhausted, retry: { attempts: 1, baseDelayMs: 1, jitter: false } })
    ).rejects.toThrow("down");
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted.mock.calls[0]?.[0].providersAttempted).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  it("calls onRetry and onFallback hooks with useful info", async () => {
    const onRetry = vi.fn();
    const onFallback = vi.fn();
    await withFallback(
      [{ name: "a" }, { name: "b" }],
      async (p) => {
        if (p.name === "a") throw err(429, "rate limited");
        return "b-ok";
      },
      { retry: { attempts: 1, baseDelayMs: 1, jitter: false }, onRetry, onFallback }
    );
    // attempts: 1 per provider means no retry hook, but a failover hook
    expect(onRetry).toHaveBeenCalledTimes(0);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0].from.name).toBe("a");
    expect(onFallback.mock.calls[0]?.[0].to?.name).toBe("b");
  });

  it("passes streams through untouched", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue("chunk");
        c.close();
      }
    });
    const result = await withFallback(
      providers,
      async () => stream,
      FAST
    );
    expect(result).toBe(stream);
    const reader = (result as ReadableStream).getReader();
    const { value, done } = await reader.read();
    expect(value).toBe("chunk");
    expect(done).toBe(false);
  });

  it("skips providers with an open circuit across calls via createFallbackCaller", async () => {
    const seen: string[] = [];
    const ask = createFallbackCaller([{ name: "a" }, { name: "b" }], {
      retry: { attempts: 1, baseDelayMs: 1, jitter: false },
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 }
    });
    const call = async (p: Provider) => {
      seen.push(p.name);
      if (p.name === "a") throw err(500, "boom");
      return "b-ok";
    };
    expect(await ask(call)).toBe("b-ok"); // a fails over (failure 1)
    expect(await ask(call)).toBe("b-ok"); // a fails over (failure 2 -> open)
    expect(await ask(call)).toBe("b-ok"); // a skipped, circuit open
    expect(seen).toEqual(["a", "b", "a", "b", "b"]);
  });

  it("respects shouldClassify overrides", async () => {
    const call = vi.fn(async () => {
      throw err(500, "server error");
    });
    await expect(
      withFallback(providers, call, {
        ...FAST,
        shouldClassify: () => "fatal"
      })
    ).rejects.toThrow("server error");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("aborts promptly on AbortSignal", async () => {
    const controller = new AbortController();
    const call = vi.fn(async () => {
      controller.abort();
      throw err(503, "slow");
    });
    await expect(
      withFallback(providers, call, {
        retry: { attempts: 5, baseDelayMs: 50, jitter: false },
        signal: controller.signal
      })
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws on empty providers", async () => {
    await expect(withFallback([], async () => 1)).rejects.toThrow(
      "must not be empty"
    );
  });

  it("createFallbackCaller binds providers and options", async () => {
    const ask = createFallbackCaller(providers, FAST);
    const result = await ask(async (p) => `hello from ${p.name}`);
    expect(result).toBe("hello from a");
  });
});
