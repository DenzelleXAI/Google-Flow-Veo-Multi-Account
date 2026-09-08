import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { createGenerationJob, listRecentGenerationJobs, updateGenerationStatus } from "@/lib/generations";
import { inngest } from "@/lib/inngest";

export async function GET(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const jobs = await listRecentGenerationJobs(projectId);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load generations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const required = ["generationRequestId", "projectId", "modelId", "promptSnapshot"];
    for (const key of required) {
      if (!body?.[key] || typeof body[key] !== "string") {
        return NextResponse.json({ error: `${key} is required` }, { status: 400 });
      }
    }

    const result = await createGenerationJob({
      generationRequestId: body.generationRequestId,
      projectId: body.projectId,
      sceneId: typeof body.sceneId === "string" ? body.sceneId : null,
      requestedApiProfileId: typeof body.requestedApiProfileId === "string" ? body.requestedApiProfileId : null,
      targetDeviceId: typeof body.targetDeviceId === "string" ? body.targetDeviceId : null,
      modelId: body.modelId,
      promptSnapshot: body.promptSnapshot,
      aspectRatioSnapshot: typeof body.aspectRatioSnapshot === "string" ? body.aspectRatioSnapshot : "9:16",
      durationSecondsSnapshot: Number.isInteger(body.durationSecondsSnapshot) ? body.durationSecondsSnapshot : null,
      resolutionSnapshot: typeof body.resolutionSnapshot === "string" ? body.resolutionSnapshot : null,
    });

    if (result.created) {
      try {
        await inngest.send({
          name: "video/generation.requested",
          data: { jobId: result.job.id },
        });
      } catch (dispatchError) {
        console.error("Failed to dispatch generation job", dispatchError);
        await updateGenerationStatus(result.job.id, "failed_retryable");
        return NextResponse.json(
          { job: { ...result.job, status: "failed_retryable" }, created: true, error: "Job saved but worker dispatch failed" },
          { status: 503 },
        );
      }
    }

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create generation job" }, { status: 500 });
  }
}
