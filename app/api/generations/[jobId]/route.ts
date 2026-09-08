import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getGenerationJob } from "@/lib/generations";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { jobId } = await context.params;
    const job = await getGenerationJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load generation job" }, { status: 500 });
  }
}
