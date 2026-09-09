import { NextResponse } from "next/server";
import { requireDb } from "@/lib/db";
import { ensurePersonalWorkspace } from "@/lib/workspace";

const allowedAspectRatios = new Set(["9:16", "16:9"]);
const allowedDurations = new Set([4, 6, 8]);
const allowedResolutions = new Set(["720p", "1080p", "4k"]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sceneId: string }> },
) {
  const { sceneId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : null;
  const durationSeconds = Number.isInteger(body.durationSeconds) ? Number(body.durationSeconds) : null;
  const resolution = typeof body.resolution === "string" ? body.resolution : null;
  const title = typeof body.title === "string" ? body.title.trim() : null;
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (aspectRatio !== null && !allowedAspectRatios.has(aspectRatio)) {
    return NextResponse.json({ error: "Unsupported aspect ratio" }, { status: 400 });
  }
  if (durationSeconds !== null && !allowedDurations.has(durationSeconds)) {
    return NextResponse.json({ error: "Duration must be 4, 6, or 8 seconds" }, { status: 400 });
  }
  if (resolution !== null && !allowedResolutions.has(resolution)) {
    return NextResponse.json({ error: "Resolution must be 720p, 1080p, or 4k" }, { status: 400 });
  }
  if (title !== null && !title) {
    return NextResponse.json({ error: "Scene title cannot be empty" }, { status: 400 });
  }

  const rows = await sql`
    update scenes s
    set title = coalesce(${title}, s.title),
        description = case when ${description}::text is null then s.description else ${description} end,
        aspect_ratio = coalesce(${aspectRatio}, s.aspect_ratio),
        duration_seconds = coalesce(${durationSeconds}, s.duration_seconds),
        resolution = coalesce(${resolution}, s.resolution),
        updated_at = now()
    from projects p
    where s.id = ${sceneId}
      and p.id = s.project_id
      and p.workspace_id = ${workspace.id}
    returning s.*
  `;

  if (!rows[0]) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  return NextResponse.json({ scene: rows[0] });
}
