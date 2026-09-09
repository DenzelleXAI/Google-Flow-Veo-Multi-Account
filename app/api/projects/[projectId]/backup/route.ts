import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { createProjectBackup } from "@/lib/project-backup";

function safeFilename(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "project";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  if (!dbConfigured) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  try {
    const { projectId } = await context.params;
    const backup = await createProjectBackup(projectId);
    if (!backup) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const projectName = String((backup.project as { name?: unknown }).name ?? "project");
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${safeFilename(projectName)}-${date}.flow-project.json`;

    return new Response(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create project backup" }, { status: 500 });
  }
}
