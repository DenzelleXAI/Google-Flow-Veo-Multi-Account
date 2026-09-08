import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { listProjectResearch, runProjectResearch } from "@/lib/research";

export async function GET(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    const limitRaw = Number(searchParams.get("limit") ?? 10);
    const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10;
    const research = await listProjectResearch(projectId, limit);
    return NextResponse.json({ research });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load research" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (!body?.projectId || typeof body.projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!body?.query || typeof body.query !== "string" || body.query.trim().length < 3) {
      return NextResponse.json({ error: "query must contain at least 3 characters" }, { status: 400 });
    }

    const urls = Array.isArray(body.urls)
      ? body.urls.filter((url: unknown) => typeof url === "string").slice(0, 10)
      : undefined;

    const result = await runProjectResearch({
      projectId: body.projectId,
      apiProfileId: typeof body.apiProfileId === "string" ? body.apiProfileId : null,
      query: body.query.trim(),
      urls,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run research";
    console.error(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
