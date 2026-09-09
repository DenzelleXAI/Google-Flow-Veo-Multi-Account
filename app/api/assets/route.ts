import { NextResponse } from "next/server";
import { listWorkspaceAssets } from "@/lib/asset-library";
import { dbConfigured } from "@/lib/db";
import { createAsset } from "@/lib/devices";

export async function GET(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const assets = await listWorkspaceAssets(projectId);
    return NextResponse.json({ assets });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load assets" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const body = await request.json();
    if (!body?.projectId || !body?.filename || !body?.type) {
      return NextResponse.json({ error: "projectId, filename and type are required" }, { status: 400 });
    }

    const asset = await createAsset({
      projectId: String(body.projectId),
      type: String(body.type),
      filename: String(body.filename),
      relativePath: typeof body.relativePath === "string" ? body.relativePath : null,
      r2Key: typeof body.r2Key === "string" ? body.r2Key : null,
      sha256: typeof body.sha256 === "string" ? body.sha256 : null,
      fileSizeBytes: Number.isFinite(body.fileSizeBytes) ? Number(body.fileSizeBytes) : null,
      width: Number.isFinite(body.width) ? Number(body.width) : null,
      height: Number.isFinite(body.height) ? Number(body.height) : null,
      durationSeconds: Number.isFinite(body.durationSeconds) ? Number(body.durationSeconds) : null,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
