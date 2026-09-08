import { NextResponse } from "next/server";
import { requireCompanionToken } from "@/lib/companion-auth";
import { dbConfigured } from "@/lib/db";
import { listDevices, registerOrHeartbeatDevice } from "@/lib/devices";

export async function GET() {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const devices = await listDevices();
    return NextResponse.json({ devices });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load devices" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    requireCompanionToken(request);
    const body = await request.json();
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "Device name is required" }, { status: 400 });
    }

    const device = await registerOrHeartbeatDevice({
      id: typeof body.id === "string" ? body.id : null,
      name: body.name.trim(),
      platform: typeof body.platform === "string" ? body.platform : null,
      mediaRoot: typeof body.mediaRoot === "string" ? body.mediaRoot : null,
      freeDiskBytes: Number.isFinite(body.freeDiskBytes) ? Number(body.freeDiskBytes) : null,
    });

    return NextResponse.json({ device });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status ?? 500);
    const message = error instanceof Error ? error.message : "Failed to register device";
    return NextResponse.json({ error: message }, { status });
  }
}
