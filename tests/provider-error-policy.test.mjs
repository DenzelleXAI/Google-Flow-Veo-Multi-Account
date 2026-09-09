import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderSubmissionFailure } from "../lib/provider-error-policy.ts";

test("400 validation errors are final", () => {
  const result = classifyProviderSubmissionFailure({ status: 400, message: "Invalid argument" });
  assert.equal(result.kind, "final");
  assert.equal(result.httpStatus, 400);
});

test("401 and 403 credential errors are final", () => {
  for (const status of [401, 403]) {
    const result = classifyProviderSubmissionFailure({ status, message: "Credential rejected" });
    assert.equal(result.kind, "final", String(status));
  }
});

test("policy block codes are final", () => {
  for (const code of ["safety", "prohibited_content", "content_blocked"]) {
    const result = classifyProviderSubmissionFailure({ error: { code, message: "Blocked" } });
    assert.equal(result.kind, "final", code);
  }
});

test("429 quota/rate rejection is retryable without being ambiguous", () => {
  const result = classifyProviderSubmissionFailure({
    response: { status: 429 },
    error: { code: "quota_exceeded", message: "Quota exceeded" },
  });
  assert.equal(result.kind, "retryable_rejected");
  assert.equal(result.httpStatus, 429);
});

test("409 aborted rejection is retryable", () => {
  const result = classifyProviderSubmissionFailure({ statusCode: 409, code: "aborted", message: "Conflict" });
  assert.equal(result.kind, "retryable_rejected");
});

test("5xx responses remain ambiguous for paid Veo submission", () => {
  for (const status of [500, 502, 503, 504]) {
    const result = classifyProviderSubmissionFailure({ status, message: "Server error" });
    assert.equal(result.kind, "ambiguous", String(status));
  }
});

test("408 and unknown network failures remain ambiguous", () => {
  assert.equal(classifyProviderSubmissionFailure({ status: 408, message: "Timeout" }).kind, "ambiguous");
  assert.equal(classifyProviderSubmissionFailure(new Error("socket hang up")).kind, "ambiguous");
});

test("string API error codes are normalized", () => {
  const result = classifyProviderSubmissionFailure({
    response: { data: { error: { code: "permission-denied", message: "No access" } } },
  });
  assert.equal(result.kind, "final");
  assert.equal(result.providerCode, "permission_denied");
});
