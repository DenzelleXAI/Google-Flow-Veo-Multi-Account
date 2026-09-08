import { NextResponse } from "next/server";
import { getGenerationJob, updateGenerationStatus } from "@/lib/generations";
import { inngest } from "@/lib/inngest";

const retryableStatuses = new Set(["failed_retryable", "failed_ambiguous", "queued"]);

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = await getGenerationJob(jobId);
    if (!job) return NextResponse.json({ error: "Generation job not found" }, { status: 404 });

    if (!retryableStatuses.has(job.status)) {
      return NextResponse.json({ error: `Job in ${job.status} state cannot be retried.` }, { status: 409 });
    }

    await updateGenerationStatus(jobId, "queued");
    await inngest.send({
      name: "video/generation.submit",
      data: { jobId },
    });

    return NextResponse.json({
      job: { ...job, status: "queued" },
      warning: job.status === "failed_ambiguous"
        ? "Previous provider submission outcome was ambiguous. Retrying may create another billable generation."
        : null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to retry generation" }, { status: 500 });
  }
}
