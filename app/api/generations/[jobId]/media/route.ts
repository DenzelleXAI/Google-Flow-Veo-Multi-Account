import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getGenerationMediaState } from "@/lib/generation-media";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { jobId } = await context.params;
    const media = await getGenerationMediaState(jobId);
    if (!media) {
      return NextResponse.json({ error: "Generation job not found" }, { status: 404 });
    }
    return NextResponse.json({ media });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load generation media state" }, { status: 500 });
  }
}
