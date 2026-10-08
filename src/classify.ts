/**
 * The error taxonomy: every failure is classified as "retry" (same provider),
 * "failover" (next provider now), or "fatal" (throw immediately).
 *
 * This is the heart of the library. The naive approach (try/catch with a
 * counter) retries fatal errors like 401s and breaks streaming; this table
 * is what makes the wrapper safe to leave in production.
 */
import type { ErrorClass } from "./types.js";

interface NormalizedError {
  status?: number;
  code?: string;
  type?: string;
  message: string;
}

/** Pull status/code/type/message out of the many shapes SDKs throw. */
function normalize(error: unknown): NormalizedError {
  const out: NormalizedError = { message: "" };
  if (error === null || error === undefined) return out;
  if (typeof error === "string") {
    out.message = error;
    return out;
  }
  if (typeof error !== "object") {
    out.message = String(error);
    return out;
  }
  const e = error as Record<string, unknown>;

  const status = e["status"] ?? e["statusCode"];
  if (typeof status === "number") out.status = status;
  else if (typeof status === "string" && /^\d+$/.test(status)) {
    out.status = parseInt(status, 10);
  }

  // Some SDKs nest the real error one level down (Anthropic: error.error).
  const nested =
    e["error"] && typeof e["error"] === "object"
      ? (e["error"] as Record<string, unknown>)
      : null;

  const code = e["code"] ?? nested?.["code"];
  if (typeof code === "string") out.code = code;
  else if (typeof code === "number") out.code = String(code);

  const type = e["type"] ?? nested?.["type"];
  if (typeof type === "string") out.type = type;

  const message = e["message"];
  if (typeof message === "string") out.message = message;
  else out.message = safeStringify(error);
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const RETRYABLE_NODE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_ABORTED"
]);

const RETRY_MESSAGE_PATTERNS: RegExp[] = [
  /timed?\s?out/i,
  /rate[\s_-]?limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /overloaded/i,
  /try again/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /internal server error/i,
  /connection (reset|refused|aborted|closed)/i,
  /socket hang up/i,
  /network error/i,
  /fetch failed/i,
  /server error/i
];

/** 429s that mean "this key is out of money", not "slow down". */
const QUOTA_MESSAGE_PATTERNS: RegExp[] = [
  /insufficient[_ ]?quota/i,
  /quota (exceeded|exhausted)/i,
  /billing/i,
  /out of credits/i,
  /credit balance/i,
  /exceeded your (current )?quota/i
];

/** Fatal no matter the status code. */
const FATAL_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "permission_denied",
  "not_found_error",
  "invalid_api_key"
]);

const FATAL_CODES = new Set([
  "invalid_api_key",
  "invalid_request_error",
  "authentication_error"
]);

/** A model missing on one provider may exist on the next: fail over, do not die. */
const FAILOVER_CODES = new Set(["model_not_found"]);

/**
 * Classify a thrown error.
 *
 * Rules, in priority order:
 * 1. Explicit fatal types/codes (bad key, bad request) -> "fatal".
 * 2. model_not_found -> "failover" (another provider may serve it).
 * 3. Quota/billing 429s -> "failover" (retrying the same key is pointless).
 * 4. Rate limits, 5xx, timeouts, network errors -> "retry".
 * 5. Other 4xx (400/401/403/404/405/422) -> "fatal".
 * 6. Unknown -> "retry" (assume transient; attempts are bounded and failover follows).
 */
export function classifyError(error: unknown): ErrorClass {
  const n = normalize(error);

  if (n.type && FATAL_TYPES.has(n.type)) return "fatal";
  if (n.code && FATAL_CODES.has(n.code)) return "fatal";
  if (n.code && FAILOVER_CODES.has(n.code)) return "failover";

  // Quota exhaustion on a 429: fail over immediately, do not hammer the same key.
  // Check code and message together: SDKs put "insufficient_quota" in code.
  if (
    n.status === 429 &&
    QUOTA_MESSAGE_PATTERNS.some((re) => re.test(`${n.code ?? ""} ${n.message}`))
  ) {
    return "failover";
  }

  if (n.status !== undefined) {
    if (n.status === 408 || n.status === 425 || n.status === 429) return "retry";
    if (n.status >= 500 && n.status < 600) return "retry";
    if (n.status >= 400 && n.status < 500) return "fatal";
  }

  if (n.code && RETRYABLE_NODE_CODES.has(n.code.toUpperCase())) return "retry";
  if (RETRY_MESSAGE_PATTERNS.some((re) => re.test(n.message))) return "retry";

  // Anthropic / OpenAI typed errors not caught above.
  if (n.type) {
    if (/rate_limit|overloaded|api_error|server_error|timeout/i.test(n.type)) {
      return "retry";
    }
  }

  // Unknown: assume transient. Attempts are bounded, failover follows.
  return "retry";
}
