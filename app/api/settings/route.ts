import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getWorkspaceSafetySettings, updateWorkspaceSafetySettings } from "@/lib/settings";

export async function GET() {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const settings = await getWorkspaceSafetySettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();

    const dailyGenerationLimit = Number.isInteger(body.dailyGenerationLimit)
      ? Number(body.dailyGenerationLimit)
      : undefined;
    const monthlyGenerationLimit = Number.isInteger(body.monthlyGenerationLimit)
      ? Number(body.monthlyGenerationLimit)
      : undefined;
    const minFreeDiskBytes = Number.isFinite(body.minFreeDiskBytes)
      ? Number(body.minFreeDiskBytes)
      : undefined;
    const deviceStaleAfterSeconds = Number.isInteger(body.deviceStaleAfterSeconds)
      ? Number(body.deviceStaleAfterSeconds)
      : undefined;

    if (dailyGenerationLimit !== undefined && dailyGenerationLimit < 1) {
      return NextResponse.json({ error: "dailyGenerationLimit must be at least 1" }, { status: 400 });
    }
    if (monthlyGenerationLimit !== undefined && monthlyGenerationLimit < 1) {
      return NextResponse.json({ error: "monthlyGenerationLimit must be at least 1" }, { status: 400 });
    }
    if (
      dailyGenerationLimit !== undefined &&
      monthlyGenerationLimit !== undefined &&
      dailyGenerationLimit > monthlyGenerationLimit
    ) {
      return NextResponse.json({ error: "Daily limit cannot exceed monthly limit" }, { status: 400 });
    }
    if (minFreeDiskBytes !== undefined && minFreeDiskBytes < 0) {
      return NextResponse.json({ error: "minFreeDiskBytes cannot be negative" }, { status: 400 });
    }
    if (deviceStaleAfterSeconds !== undefined && deviceStaleAfterSeconds < 30) {
      return NextResponse.json({ error: "deviceStaleAfterSeconds must be at least 30" }, { status: 400 });
    }

    const settings = await updateWorkspaceSafetySettings({
      defaultTargetDeviceId:
        body.defaultTargetDeviceId === null || typeof body.defaultTargetDeviceId === "string"
          ? body.defaultTargetDeviceId
          : undefined,
      dailyGenerationLimit,
      monthlyGenerationLimit,
      minFreeDiskBytes,
      deviceStaleAfterSeconds,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
