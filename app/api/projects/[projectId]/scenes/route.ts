import { NextResponse } from "next/server";
import { createScene, listScenes } from "@/lib/workspace";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const scenes = await listScenes(projectId);
    return NextResponse.json({ scenes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load scenes" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";

    if (!title) {
      return NextResponse.json({ error: "Scene title is required" }, { status: 400 });
    }

    const scene = await createScene(projectId, title);
    return NextResponse.json({ scene }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create scene" },
      { status: 500 },
    );
  }
}
