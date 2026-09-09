import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { runExtensionPreflight } from "@/lib/extension-preflight";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { jobId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const modelId = typeof body.modelId === "string" ? body.modelId : "veo-3.1-generate-preview";
    const requestedApiProfileId = typeof body.requestedApiProfileId === "string" ? body.requestedApiProfileId : null;
    const targetDeviceId = typeof body.targetDeviceId === "string" ? body.targetDeviceId : null;

    const result = await runExtensionPreflight({
      parentJobId: jobId,
      modelId,
      requestedApiProfileId,
      targetDeviceId,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extension preflight failed" },
      { status: 500 },
    );
  }
}
