import { describe, expect, it } from "vitest";
import { classifyError } from "../src/classify.js";

describe("classifyError", () => {
  it.each([
    // [description, error, expected]
    ["429 rate limit retries", { status: 429, message: "Rate limit exceeded" }, "retry"],
    ["503 retries", { status: 503, message: "Service unavailable" }, "retry"],
    ["500 retries", { status: 500 }, "retry"],
    ["502 retries", { statusCode: 502 }, "retry"],
    ["504 retries", { status: 504 }, "retry"],
    ["408 retries", { status: 408 }, "retry"],
    ["401 is fatal", { status: 401, message: "Invalid API key" }, "fatal"],
    ["400 is fatal", { status: 400, message: "Bad request" }, "fatal"],
    ["403 is fatal", { status: 403 }, "fatal"],
    ["404 is fatal", { status: 404 }, "fatal"],
    ["422 is fatal", { status: 422 }, "fatal"],
    ["insufficient_quota 429 fails over", { status: 429, code: "insufficient_quota", message: "You exceeded your current quota" }, "failover"],
    ["billing 429 fails over", { status: 429, message: "Billing hard limit reached" }, "failover"],
    ["model_not_found fails over", { status: 404, code: "model_not_found", message: "model not found" }, "failover"],
    ["invalid_api_key code is fatal", { code: "invalid_api_key" }, "fatal"],
    ["invalid_request_error type is fatal", { error: { type: "invalid_request_error", message: "bad" } }, "fatal"],
    ["Anthropic overloaded_error retries", { error: { type: "overloaded_error" } }, "retry"],
    ["Anthropic rate_limit_error retries", { error: { type: "rate_limit_error" } }, "retry"],
    ["ETIMEDOUT retries", { code: "ETIMEDOUT", message: "connect ETIMEDOUT" }, "retry"],
    ["ECONNRESET retries", { code: "ECONNRESET" }, "retry"],
    ["ENOTFOUND retries", { code: "ENOTFOUND" }, "retry"],
    ["socket hang up retries", new Error("socket hang up"), "retry"],
    ["timeout message retries", new Error("Request timed out after 30000ms"), "retry"],
    ["string timeout retries", "fetch failed: timeout", "retry"],
    ["unknown error retries (bounded by attempts)", { weird: true }, "retry"]
  ])("%s", (_desc, error, expected) => {
    expect(classifyError(error)).toBe(expected);
  });

  it("never retries a 401 even with a retry-looking message", () => {
    expect(
      classifyError({ status: 401, message: "try again with a valid key" })
    ).toBe("fatal");
  });
});
