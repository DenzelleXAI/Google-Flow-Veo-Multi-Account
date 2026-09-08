import { NextResponse } from "next/server";
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
    console.error(error);
    return NextResponse.json({ error: "Failed to update asset location" }, { status: 500 });
  }
}
