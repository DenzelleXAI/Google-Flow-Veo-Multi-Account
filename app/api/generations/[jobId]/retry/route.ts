import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireDb } from "@/lib/db";
import {
  assertGenerationInfrastructureReady,
  GenerationInfrastructureError,
} from "@/lib/generation-infrastructure";
import { decideGenerationRetry } from "@/lib/generation-retry-policy";
import { getGenerationJob, updateGenerationStatus } from "@/lib/generations";
import { inngest } from "@/lib/inngest";
import { resolveGoogleProfile } from "@/lib/provider-profiles";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = await getGenerationJob(jobId);
    if (!job) return NextResponse.json({ error: "Generation job not found" }, { status: 404 });

    const decision = decideGenerationRetry(job);
    if (decision.action === "block") {
      const error = decision.code === "AMBIGUOUS_SUBMISSION_NO_RETRY"
        ? "This provider submission is ambiguous and cannot be retried on the same job. The provider may already have accepted a billable generation. Inspect the attempt before intentionally creating a new Generate action."
        : decision.reason;
      return NextResponse.json({ error, code: decision.code }, { status: 409 });
    }

    // If we already know the provider operation ID, provider submission has
    // happened. Retry means resume monitoring/download/relay only; never call
    // generateVideos again for this logical job.
    if (decision.action === "resume_monitor") {
      const latestAttempt = decision.attempt;
      await assertGenerationInfrastructureReady(job.requested_api_profile_id);
      const resolved = latestAttempt.api_profile_id
        ? await resolveGoogleProfile(latestAttempt.api_profile_id)
        : await resolveGoogleProfile(job.requested_api_profile_id);
      const sql = requireDb();

      await sql`
        update generation_attempts
        set status = 'provider_pending',
            error_code = null,
            error_message = null,
            completed_at = null
        where id = ${latestAttempt.id}
          and generation_job_id = ${job.id}
      `;
      await updateGenerationStatus(job.id, "provider_pending");

      try {
        await inngest.send({
          id: `video-monitor-manual-${latestAttempt.id}-${randomUUID()}`,
          name: "video/generation.monitor",
          data: {
            jobId: job.id,
            attemptId: latestAttempt.id,
            apiProfileId: resolved.profile.id,
            operationName: latestAttempt.provider_operation_id,
          },
        });
      } catch (dispatchError) {
        await sql`
          update generation_attempts
          set status = 'failed_retryable',
              error_code = 'MONITOR_DISPATCH_FAILED',
              error_message = 'Failed to dispatch monitor retry.'
          where id = ${latestAttempt.id}
        `;
        await updateGenerationStatus(job.id, "failed_retryable");
        throw dispatchError;
      }

      return NextResponse.json({
        job: { ...job, status: "provider_pending" },
        resumedExistingOperation: true,
        providerResubmitted: false,
      });
    }

    // No provider operation exists. This is the safe retry path for failures
    // such as an Inngest dispatch outage before submission started.
    await assertGenerationInfrastructureReady(job.requested_api_profile_id);
    await updateGenerationStatus(jobId, "queued");
    await inngest.send({
      id: `video-submit-retry-${job.id}-${randomUUID()}`,
      name: "video/generation.submit",
      data: { jobId },
    });

    return NextResponse.json({
      job: { ...job, status: "queued" },
      resumedExistingOperation: false,
      providerResubmitted: true,
    });
  } catch (error) {
    if (error instanceof GenerationInfrastructureError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to retry generation" }, { status: 500 });
  }
}
