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
    const dailySpendLimitUsd = Number.isFinite(body.dailySpendLimitUsd)
      ? Number(body.dailySpendLimitUsd)
      : undefined;
    const monthlySpendLimitUsd = Number.isFinite(body.monthlySpendLimitUsd)
      ? Number(body.monthlySpendLimitUsd)
      : undefined;
    const perRequestSpendLimitUsd = Number.isFinite(body.perRequestSpendLimitUsd)
      ? Number(body.perRequestSpendLimitUsd)
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

    for (const [name, value] of [
      ["dailySpendLimitUsd", dailySpendLimitUsd],
      ["monthlySpendLimitUsd", monthlySpendLimitUsd],
      ["perRequestSpendLimitUsd", perRequestSpendLimitUsd],
    ] as const) {
      if (value !== undefined && value <= 0) {
        return NextResponse.json({ error: `${name} must be greater than 0` }, { status: 400 });
      }
    }

    if (
      dailySpendLimitUsd !== undefined &&
      monthlySpendLimitUsd !== undefined &&
      dailySpendLimitUsd > monthlySpendLimitUsd
    ) {
      return NextResponse.json({ error: "Daily spend limit cannot exceed monthly spend limit" }, { status: 400 });
    }
    if (
      perRequestSpendLimitUsd !== undefined &&
      dailySpendLimitUsd !== undefined &&
      perRequestSpendLimitUsd > dailySpendLimitUsd
    ) {
      return NextResponse.json({ error: "Per-request spend limit cannot exceed daily spend limit" }, { status: 400 });
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
      dailySpendLimitUsd,
      monthlySpendLimitUsd,
      perRequestSpendLimitUsd,
      minFreeDiskBytes,
      deviceStaleAfterSeconds,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
