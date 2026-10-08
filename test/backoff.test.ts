import { describe, expect, it } from "vitest";
import { computeDelay, resolveRetryPolicy } from "../src/backoff.js";

describe("backoff", () => {
  it("computes exponential delays without jitter", () => {
    const policy = resolveRetryPolicy({ jitter: false, baseDelayMs: 500 });
    expect(computeDelay(1, policy)).toBe(500);
    expect(computeDelay(2, policy)).toBe(1000);
    expect(computeDelay(3, policy)).toBe(2000);
  });

  it("caps at maxDelayMs", () => {
    const policy = resolveRetryPolicy({
      jitter: false,
      baseDelayMs: 1000,
      maxDelayMs: 1500
    });
    expect(computeDelay(5, policy)).toBe(1500);
  });

  it("applies full jitter within [0, capped]", () => {
    const policy = resolveRetryPolicy({ jitter: true, baseDelayMs: 1000 });
    for (let i = 0; i < 50; i++) {
      const d = computeDelay(3, policy, () => 0.5);
      expect(d).toBe(2000); // 0.5 * min(10000, 1000 * 2^2)
    }
    const zero = computeDelay(3, policy, () => 0);
    expect(zero).toBe(0);
  });

  it("supports linear and constant strategies", () => {
    const linear = resolveRetryPolicy({ jitter: false, backoff: "linear", baseDelayMs: 200 });
    expect(computeDelay(3, linear)).toBe(600);
    const constant = resolveRetryPolicy({ jitter: false, backoff: "constant", baseDelayMs: 200 });
    expect(computeDelay(3, constant)).toBe(200);
  });

  it("supports a custom backoff function", () => {
    const custom = resolveRetryPolicy({
      jitter: false,
      backoff: (attempt) => attempt * 100
    });
    expect(computeDelay(4, custom)).toBe(400);
  });

  it("defaults attempts to 3", () => {
    expect(resolveRetryPolicy().attempts).toBe(3);
  });
});
