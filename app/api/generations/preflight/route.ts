import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { runGenerationPreflight } from "@/lib/generation-preflight";

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (!body?.projectId || typeof body.projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!body?.modelId || typeof body.modelId !== "string") {
      return NextResponse.json({ error: "modelId is required" }, { status: 400 });
    }

    const result = await runGenerationPreflight({
      projectId: body.projectId,
      requestedApiProfileId: typeof body.requestedApiProfileId === "string" ? body.requestedApiProfileId : null,
      targetDeviceId: typeof body.targetDeviceId === "string" ? body.targetDeviceId : null,
      modelId: body.modelId,
      aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : "9:16",
      durationSeconds: Number.isInteger(body.durationSeconds) ? body.durationSeconds : 8,
      resolution: typeof body.resolution === "string" ? body.resolution : "1080p",
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Generation preflight failed" }, { status: 500 });
  }
}
