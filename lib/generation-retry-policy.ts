export type RetryAttemptLike = {
  id: string;
  started_at: string | Date;
  provider_operation_id?: string | null;
  api_profile_id?: string | null;
  status?: string | null;
  error_code?: string | null;
};

export type RetryJobLike = {
  status: string;
  attempts: RetryAttemptLike[];
};

export type GenerationRetryDecision =
  | { action: "block"; code: "AMBIGUOUS_SUBMISSION_NO_RETRY" | "STATE_NOT_RETRYABLE"; reason: string }
  | { action: "resume_monitor"; attempt: RetryAttemptLike }
  | { action: "resubmit_provider" };

export function latestGenerationAttempt(attempts: RetryAttemptLike[]) {
  return [...attempts].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )[0] ?? null;
}

function attemptIsAmbiguous(attempt: RetryAttemptLike | null) {
  if (!attempt) return false;
  if (attempt.status === "provider_submit_claimed" || attempt.status === "failed_ambiguous") return true;
  return typeof attempt.error_code === "string" && attempt.error_code.startsWith("AMBIGUOUS_SUBMISSION");
}

export function decideGenerationRetry(job: RetryJobLike): GenerationRetryDecision {
  if (job.status === "failed_ambiguous") {
    return {
      action: "block",
      code: "AMBIGUOUS_SUBMISSION_NO_RETRY",
      reason:
        "Provider submission is ambiguous. Retrying the same logical job could create a second billable generation.",
    };
  }

  if (!new Set(["failed_retryable", "queued"]).has(job.status)) {
    return {
      action: "block",
      code: "STATE_NOT_RETRYABLE",
      reason: `Job in ${job.status} state cannot be retried.`,
    };
  }

  const latestAttempt = latestGenerationAttempt(job.attempts);
  if (latestAttempt?.provider_operation_id) {
    return { action: "resume_monitor", attempt: latestAttempt };
  }

  // Defense in depth: even if some unrelated bug or manual repair accidentally
  // downgrades the job from FAILED_AMBIGUOUS to FAILED_RETRYABLE/QUEUED, a
  // consumed provider-submit claim or ambiguity marker still blocks a second
  // billable request for this logical job.
  if (attemptIsAmbiguous(latestAttempt)) {
    return {
      action: "block",
      code: "AMBIGUOUS_SUBMISSION_NO_RETRY",
      reason:
        "The latest attempt crossed the paid provider-submit boundary without a durable provider operation ID. Automatic resubmission is blocked.",
    };
  }

  return { action: "resubmit_provider" };
}
