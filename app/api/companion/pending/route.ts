import { NextResponse } from "next/server";
import { requireCompanionToken } from "@/lib/companion-auth";
import { listPendingLocalAssets } from "@/lib/companion";
import { dbConfigured } from "@/lib/db";

export async function GET(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    requireCompanionToken(request);
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
    }

    const assets = await listPendingLocalAssets(deviceId);
    return NextResponse.json({ assets });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status ?? 500);
    const message = error instanceof Error ? error.message : "Failed to load pending media";
    return NextResponse.json({ error: message }, { status });
  }
}
