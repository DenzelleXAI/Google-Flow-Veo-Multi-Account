export type RetryAttemptLike = {
  id: string;
  started_at: string | Date;
  provider_operation_id?: string | null;
  api_profile_id?: string | null;
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

  return { action: "resubmit_provider" };
}
