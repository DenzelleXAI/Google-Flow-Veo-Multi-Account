import { NextResponse } from "next/server";
import { listAgentMessages, saveAgentMessage } from "@/lib/agent-store";
import { runProjectAgent } from "@/lib/project-agent";

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    return NextResponse.json({ messages: await listAgentMessages(projectId) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load agent history" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const apiProfileId = typeof body.apiProfileId === "string" ? body.apiProfileId : null;

    if (!projectId || !message) {
      return NextResponse.json({ error: "projectId and message are required" }, { status: 400 });
    }

    await saveAgentMessage(projectId, "user", message);
    const history = await listAgentMessages(projectId, 30);
    const result = await runProjectAgent({
      projectId,
      apiProfileId,
      messages: history.map(({ role, content }) => ({ role, content })),
    });
    const assistant = await saveAgentMessage(projectId, "assistant", result.text);
    return NextResponse.json({ assistant });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Agent request failed" }, { status: 500 });
  }
}
