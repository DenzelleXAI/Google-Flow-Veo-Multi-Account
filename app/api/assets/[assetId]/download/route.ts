import { NextResponse } from "next/server";
import { dbConfigured, requireDb } from "@/lib/db";
import { createRelayDownloadUrl } from "@/lib/r2";
import { ensurePersonalWorkspace } from "@/lib/workspace";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { assetId } = await context.params;
    const workspace = await ensurePersonalWorkspace();
    const sql = requireDb();
    const rows = await sql`
      select a.id, a.filename, a.r2_key, a.relay_deleted_at
      from assets a
      join projects p on p.id = a.project_id
      where a.id = ${assetId}
        and p.workspace_id = ${workspace.id}
      limit 1
    `;
    const asset = rows[0];
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    if (!asset.r2_key || asset.relay_deleted_at) {
      return NextResponse.json({ error: "Relay copy is no longer available" }, { status: 410 });
    }

    const downloadUrl = await createRelayDownloadUrl(String(asset.r2_key), 300);
    return NextResponse.json({
      assetId: String(asset.id),
      filename: String(asset.filename),
      downloadUrl,
      expiresInSeconds: 300,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create relay download link" }, { status: 500 });
  }
}
