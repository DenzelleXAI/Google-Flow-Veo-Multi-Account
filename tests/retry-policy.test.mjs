import test from "node:test";
import assert from "node:assert/strict";
import { decideGenerationRetry } from "../lib/generation-retry-policy.ts";

const attempt = (overrides = {}) => ({
  id: "attempt-1",
  started_at: "2026-09-09T00:00:00.000Z",
  provider_operation_id: null,
  api_profile_id: "profile-1",
  status: "submitting",
  error_code: null,
  ...overrides,
});

test("ambiguous submission can never retry the same logical job", () => {
  const result = decideGenerationRetry({
    status: "failed_ambiguous",
    attempts: [attempt()],
  });
  assert.deepEqual(result.action, "block");
  assert.equal(result.code, "AMBIGUOUS_SUBMISSION_NO_RETRY");
});

test("retryable job with known provider operation resumes monitor", () => {
  const result = decideGenerationRetry({
    status: "failed_retryable",
    attempts: [attempt({ status: "failed_retryable", provider_operation_id: "operations/veo-123" })],
  });
  assert.equal(result.action, "resume_monitor");
  assert.equal(result.attempt.provider_operation_id, "operations/veo-123");
});

test("retryable pre-submit failure can safely resubmit provider", () => {
  const result = decideGenerationRetry({
    status: "failed_retryable",
    attempts: [attempt({ status: "submitting", provider_operation_id: null })],
  });
  assert.equal(result.action, "resubmit_provider");
});

test("explicit provider rejection can safely resubmit provider", () => {
  const result = decideGenerationRetry({
    status: "failed_retryable",
    attempts: [attempt({
      status: "failed_retryable",
      error_code: "PROVIDER_REJECTED_http_429",
      provider_operation_id: null,
    })],
  });
  assert.equal(result.action, "resubmit_provider");
});

test("consumed submit claim blocks retry even if job state is downgraded", () => {
  for (const status of ["failed_retryable", "queued"]) {
    const result = decideGenerationRetry({
      status,
      attempts: [attempt({ status: "provider_submit_claimed", provider_operation_id: null })],
    });
    assert.equal(result.action, "block");
    assert.equal(result.code, "AMBIGUOUS_SUBMISSION_NO_RETRY");
  }
});

test("ambiguity error marker blocks retry even if attempt status is downgraded", () => {
  const result = decideGenerationRetry({
    status: "failed_retryable",
    attempts: [attempt({
      status: "failed_retryable",
      error_code: "AMBIGUOUS_SUBMISSION_PROCESS_INTERRUPTION",
    })],
  });
  assert.equal(result.action, "block");
  assert.equal(result.code, "AMBIGUOUS_SUBMISSION_NO_RETRY");
});

test("queued job without provider operation can dispatch submit", () => {
  const result = decideGenerationRetry({ status: "queued", attempts: [] });
  assert.equal(result.action, "resubmit_provider");
});

test("latest attempt controls resume decision", () => {
  const result = decideGenerationRetry({
    status: "failed_retryable",
    attempts: [
      attempt({ id: "older", started_at: "2026-09-09T00:00:00.000Z", provider_operation_id: null }),
      attempt({ id: "newer", started_at: "2026-09-09T00:01:00.000Z", provider_operation_id: "operations/latest" }),
    ],
  });
  assert.equal(result.action, "resume_monitor");
  assert.equal(result.attempt.id, "newer");
});

test("completed and active states are not retryable", () => {
  for (const status of ["cloud_ready", "local_confirmed", "provider_pending", "submitting", "cancelled", "failed_final"]) {
    const result = decideGenerationRetry({ status, attempts: [] });
    assert.equal(result.action, "block", status);
    assert.equal(result.code, "STATE_NOT_RETRYABLE", status);
  }
});
