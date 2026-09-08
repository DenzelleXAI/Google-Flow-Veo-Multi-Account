import { NextResponse } from "next/server";
import { savePromptVersion } from "@/lib/workspace";

export const runtime = "nodejs";

type Context = { params: Promise<{ sceneId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { sceneId } = await context.params;
    const body = await request.json();
    const content = typeof body?.content === "string" ? body.content.trim() : "";

    if (!content) {
      return NextResponse.json({ error: "Prompt content is required" }, { status: 400 });
    }

    const promptVersion = await savePromptVersion(sceneId, content);
    return NextResponse.json({ promptVersion }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save prompt" },
      { status: 500 },
    );
  }
}
