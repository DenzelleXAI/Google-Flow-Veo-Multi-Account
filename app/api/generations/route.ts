import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { createGenerationJob, listRecentGenerationJobs } from "@/lib/generations";

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
    const required = ["generationRequestId", "projectId", "modelId"];
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
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create generation job" }, { status: 500 });
  }
}
