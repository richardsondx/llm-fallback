import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  resolveCircuitBreakerPolicy
} from "../src/circuit.js";

describe("CircuitBreaker", () => {
  it("starts closed and records success", () => {
    const cb = new CircuitBreaker(resolveCircuitBreakerPolicy());
    expect(cb.isOpen()).toBe(false);
    cb.recordSuccess();
    expect(cb.isOpen()).toBe(false);
  });

  it("opens after the failure threshold", () => {
    const cb = new CircuitBreaker(
      resolveCircuitBreakerPolicy({ failureThreshold: 3 })
    );
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });

  it("half-opens after the reset timeout and closes on success", () => {
    const cb = new CircuitBreaker(
      resolveCircuitBreakerPolicy({ failureThreshold: 1, resetTimeoutMs: 100 })
    );
    const t0 = Date.now();
    cb.recordFailure(t0);
    expect(cb.isOpen(t0 + 50)).toBe(true);
    expect(cb.isOpen(t0 + 150)).toBe(false); // half-open probe allowed
    cb.recordSuccess();
    expect(cb.isOpen(t0 + 160)).toBe(false);
  });

  it("re-opens when a half-open probe fails", () => {
    const cb = new CircuitBreaker(
      resolveCircuitBreakerPolicy({ failureThreshold: 1, resetTimeoutMs: 100 })
    );
    const t0 = Date.now();
    cb.recordFailure(t0);
    expect(cb.isOpen(t0 + 150)).toBe(false); // half-open
    cb.recordFailure(t0 + 150);
    expect(cb.isOpen(t0 + 160)).toBe(true);
  });
});
