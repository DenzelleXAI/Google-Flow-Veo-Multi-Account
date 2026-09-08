import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import {
  createGenerationJob,
  GenerationSafetyError,
  listRecentGenerationJobs,
  updateGenerationStatus,
  type GenerationAssetInput,
} from "@/lib/generations";
import { inngest } from "@/lib/inngest";
import { validateVeoSettings } from "@/lib/model-registry";

const allowedRoles = new Set<GenerationAssetInput["role"]>(["initial_frame", "last_frame", "reference_asset"]);

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

    const aspectRatioSnapshot = typeof body.aspectRatioSnapshot === "string" ? body.aspectRatioSnapshot : "9:16";
    const durationSecondsSnapshot = Number.isInteger(body.durationSecondsSnapshot) ? body.durationSecondsSnapshot : 8;
    const resolutionSnapshot = typeof body.resolutionSnapshot === "string" ? body.resolutionSnapshot : "720p";

    const capabilityError = validateVeoSettings({
      modelId: body.modelId,
      aspectRatio: aspectRatioSnapshot,
      durationSeconds: durationSecondsSnapshot,
      resolution: resolutionSnapshot,
    });
    if (capabilityError) {
      return NextResponse.json({ error: capabilityError }, { status: 400 });
    }

    const assetInputs: GenerationAssetInput[] = [];
    if (Array.isArray(body.assetInputs)) {
      for (const [index, raw] of body.assetInputs.entries()) {
        if (!raw || typeof raw.assetId !== "string" || !allowedRoles.has(raw.role)) {
          return NextResponse.json({ error: `Invalid assetInputs[${index}]` }, { status: 400 });
        }
        assetInputs.push({
          assetId: raw.assetId,
          role: raw.role,
          sortOrder: Number.isInteger(raw.sortOrder) ? raw.sortOrder : index,
        });
      }
    }

    const initialCount = assetInputs.filter((item) => item.role === "initial_frame").length;
    const lastCount = assetInputs.filter((item) => item.role === "last_frame").length;
    const referenceCount = assetInputs.filter((item) => item.role === "reference_asset").length;
    if (initialCount > 1 || lastCount > 1 || referenceCount > 3) {
      return NextResponse.json({ error: "Use at most one initial frame, one last frame, and three reference images" }, { status: 400 });
    }
    if (lastCount && !initialCount) {
      return NextResponse.json({ error: "A last frame requires an initial frame" }, { status: 400 });
    }
    if (referenceCount && durationSecondsSnapshot !== 8) {
      return NextResponse.json({ error: "Reference-image generation requires an 8-second duration" }, { status: 400 });
    }
    if (referenceCount && body.modelId.includes("lite")) {
      return NextResponse.json({ error: "Veo 3.1 Lite does not support reference images" }, { status: 400 });
    }

    const result = await createGenerationJob({
      generationRequestId: body.generationRequestId,
      projectId: body.projectId,
      sceneId: typeof body.sceneId === "string" ? body.sceneId : null,
      requestedApiProfileId: typeof body.requestedApiProfileId === "string" ? body.requestedApiProfileId : null,
      targetDeviceId: typeof body.targetDeviceId === "string" ? body.targetDeviceId : null,
      modelId: body.modelId,
      promptSnapshot: body.promptSnapshot,
      aspectRatioSnapshot,
      durationSecondsSnapshot,
      resolutionSnapshot,
      assetInputs,
    });

    if (result.created) {
      try {
        await inngest.send({
          name: "video/generation.submit",
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
    if (error instanceof GenerationSafetyError) {
      const status = error.code === "DAILY_LIMIT" || error.code === "MONTHLY_LIMIT" ? 429 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to create generation job" }, { status: 500 });
  }
}
