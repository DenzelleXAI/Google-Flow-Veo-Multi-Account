import { NextResponse } from "next/server";
import { requireCompanionToken } from "@/lib/companion-auth";
import { dbConfigured } from "@/lib/db";
import { upsertAssetLocation } from "@/lib/devices";

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    requireCompanionToken(request);
    const { assetId } = await context.params;
    const body = await request.json();

    if (!body?.deviceId || !body?.status) {
      return NextResponse.json({ error: "deviceId and status are required" }, { status: 400 });
    }

    const location = await upsertAssetLocation({
      assetId,
      deviceId: String(body.deviceId),
      relativePath: typeof body.relativePath === "string" ? body.relativePath : null,
      status: String(body.status),
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : null,
      verifiedHash: typeof body.verifiedHash === "string" ? body.verifiedHash : null,
      fileSizeBytes: Number.isFinite(body.fileSizeBytes) ? Number(body.fileSizeBytes) : null,
    });

    return NextResponse.json({ location });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status ?? 500);
    const message = error instanceof Error ? error.message : "Failed to update asset location";
    return NextResponse.json({ error: message }, { status });
  }
}
