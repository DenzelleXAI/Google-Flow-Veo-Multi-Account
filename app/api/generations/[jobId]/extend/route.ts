import { NextResponse } from "next/server";
import {
  createGenerationJob,
  GenerationSafetyError,
  getGenerationJob,
  updateGenerationStatus,
} from "@/lib/generations";
import { findGenerationJobByRequestId } from "@/lib/generation-idempotency";
import {
  assertGenerationInfrastructureReady,
  GenerationInfrastructureError,
} from "@/lib/generation-infrastructure";
import { inngest } from "@/lib/inngest";
import { validateVeoSettings } from "@/lib/model-registry";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const generationRequestId = typeof body.generationRequestId === "string" ? body.generationRequestId : "";
    const modelId = typeof body.modelId === "string" ? body.modelId : "veo-3.1-generate-preview";
    const promptSnapshot = typeof body.promptSnapshot === "string" ? body.promptSnapshot : "";
    const requestedApiProfileId = typeof body.requestedApiProfileId === "string" ? body.requestedApiProfileId : null;
    const targetDeviceId = typeof body.targetDeviceId === "string" ? body.targetDeviceId : null;

    if (!generationRequestId) {
      return NextResponse.json({ error: "generationRequestId is required" }, { status: 400 });
    }

    const existing = await findGenerationJobByRequestId(generationRequestId);
    if (existing) {
      return NextResponse.json({ job: existing, created: false }, { status: 200 });
    }

    const parent = await getGenerationJob(jobId);
    if (!parent) {
      return NextResponse.json({ error: "Parent generation not found" }, { status: 404 });
    }

    const capabilityError = validateVeoSettings({
      modelId,
      resolution: "720p",
      durationSeconds: 8,
      aspectRatio: parent.aspect_ratio_snapshot,
      isExtension: true,
    });
    if (capabilityError) {
      return NextResponse.json({ error: capabilityError }, { status: 400 });
    }

    await assertGenerationInfrastructureReady(requestedApiProfileId);

    const result = await createGenerationJob({
      generationRequestId,
      projectId: parent.project_id,
      sceneId: parent.scene_id,
      requestedApiProfileId,
      targetDeviceId,
      modelId,
      promptSnapshot,
      aspectRatioSnapshot: parent.aspect_ratio_snapshot,
      durationSecondsSnapshot: 8,
      resolutionSnapshot: "720p",
      generationMode: "extend",
      parentGenerationJobId: parent.id,
    });

    if (result.created) {
      try {
        await inngest.send({
          name: "video/generation.submit",
          data: { jobId: result.job.id },
        });
      } catch (dispatchError) {
        console.error("Failed to dispatch extension job", dispatchError);
        await updateGenerationStatus(result.job.id, "failed_retryable");
        return NextResponse.json(
          {
            job: { ...result.job, status: "failed_retryable" },
            created: true,
            error: "Extension job saved but worker dispatch failed",
          },
          { status: 503 },
        );
      }
    }

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof GenerationInfrastructureError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    if (error instanceof GenerationSafetyError) {
      const status = error.code === "DAILY_LIMIT" || error.code === "MONTHLY_LIMIT" ? 429 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to create extension job" }, { status: 500 });
  }
}
