import { requireDb } from "./db";

export type ProviderSubmissionClaim = {
  claimed: boolean;
  attemptId: string;
  status: string | null;
  providerOperationId: string | null;
};

/**
 * Atomically claims the one allowed provider-submit execution for an attempt.
 *
 * This is intentionally fail-closed. The first execution changes the attempt
 * from `submitting` to `provider_submit_claimed` before the non-idempotent Veo
 * HTTP request begins. If the process is killed after that durable write but
 * before the provider operation ID is persisted, a replay cannot claim the
 * same attempt again and therefore must not call Veo again.
 *
 * The tradeoff is deliberate: a crash after the claim but before the HTTP
 * request reaches Google can leave a false-positive ambiguous attempt. Human
 * review is safer than a possible duplicate billable generation.
 */
export async function claimProviderSubmission(attemptId: string): Promise<ProviderSubmissionClaim> {
  const sql = requireDb();

  return sql.begin(async (tx) => {
    const claimed = await tx`
      update generation_attempts
      set status = 'provider_submit_claimed'
      where id = ${attemptId}
        and status = 'submitting'
        and provider_operation_id is null
      returning id, status, provider_operation_id
    `;

    if (claimed[0]) {
      return {
        claimed: true,
        attemptId: String(claimed[0].id),
        status: String(claimed[0].status),
        providerOperationId: null,
      };
    }

    const current = await tx`
      select id, status, provider_operation_id
      from generation_attempts
      where id = ${attemptId}
      limit 1
    `;
    const row = current[0];

    return {
      claimed: false,
      attemptId,
      status: row ? String(row.status) : null,
      providerOperationId: row?.provider_operation_id ? String(row.provider_operation_id) : null,
    };
  });
}

export type StaleProviderSubmission = {
  jobId: string;
  attemptId: string;
};

/**
 * Converts abandoned claimed submissions into FAILED_AMBIGUOUS so they are
 * visible and cannot be automatically resubmitted. This is an observability
 * and safety backstop for host eviction/OOM/redeploy cases where the original
 * process never returns to Inngest.
 */
export async function failClosedStaleProviderSubmissions(
  olderThanSeconds = 120,
  limit = 100,
): Promise<StaleProviderSubmission[]> {
  const sql = requireDb();
  const safeAge = Math.max(30, Math.trunc(olderThanSeconds));
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));

  return sql.begin(async (tx) => {
    const rows = await tx`
      select a.id as attempt_id, a.generation_job_id as job_id
      from generation_attempts a
      join generation_jobs j on j.id = a.generation_job_id
      where a.status = 'provider_submit_claimed'
        and a.provider_operation_id is null
        and j.status = 'submitting'
        and a.started_at <= now() - (${safeAge} * interval '1 second')
      order by a.started_at asc
      limit ${safeLimit}
      for update of a, j skip locked
    `;

    const failed: StaleProviderSubmission[] = [];
    for (const row of rows) {
      const attemptId = String(row.attempt_id);
      const jobId = String(row.job_id);

      const attempt = await tx`
        update generation_attempts
        set status = 'failed_ambiguous',
            error_code = 'AMBIGUOUS_SUBMISSION_PROCESS_INTERRUPTION',
            error_message = 'Paid provider submission was claimed but no provider operation ID was persisted before the safety timeout. Do not auto-resubmit this logical job.',
            completed_at = coalesce(completed_at, now())
        where id = ${attemptId}
          and status = 'provider_submit_claimed'
          and provider_operation_id is null
        returning id
      `;
      if (!attempt[0]) continue;

      await tx`
        update generation_jobs
        set status = 'failed_ambiguous', updated_at = now()
        where id = ${jobId}
          and status = 'submitting'
      `;

      failed.push({ jobId, attemptId });
    }

    return failed;
  });
}
