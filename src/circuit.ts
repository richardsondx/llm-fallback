/**
 * Minimal per-provider circuit breaker.
 *
 * Only provider-level failures (failover transitions) trip the breaker;
 * fatal request errors never do. States: closed -> open -> half-open.
 */
import type { ResolvedCircuitBreakerPolicy } from "./types.js";

type State = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: State = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(policy: ResolvedCircuitBreakerPolicy) {
    this.failureThreshold = policy.failureThreshold;
    this.resetTimeoutMs = policy.resetTimeoutMs;
  }

  /** True when calls should be skipped (circuit open and not yet eligible for a probe). */
  isOpen(now: number = Date.now()): boolean {
    if (this.state === "open") {
      if (now - this.openedAt >= this.resetTimeoutMs) {
        this.state = "half-open";
        return false;
      }
      return true;
    }
    return false;
  }

  /** Record a provider-level failure (a failover away from this provider). */
  recordFailure(now: number = Date.now()): void {
    if (this.state === "half-open") {
      this.open(now);
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.open(now);
    }
  }

  /** Record a success; closes the circuit from any state. */
  recordSuccess(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
  }

  private open(now: number): void {
    this.state = "open";
    this.openedAt = now;
  }
}

export function resolveCircuitBreakerPolicy(policy: {
  failureThreshold?: number;
  resetTimeoutMs?: number;
} = {}): ResolvedCircuitBreakerPolicy {
  return {
    failureThreshold: policy.failureThreshold ?? 5,
    resetTimeoutMs: policy.resetTimeoutMs ?? 60_000
  };
}
