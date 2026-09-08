import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";
import { requireDb } from "./db";
import { resolveGoogleProfile } from "./provider-profiles";
import { createScene, savePromptVersion } from "./workspace";

async function getProjectContext(projectId: string) {
  const sql = requireDb();
  const projectRows = await sql`
    select id, name, description
    from projects
    where id = ${projectId}
    limit 1
  `;
  if (!projectRows[0]) throw new Error("Project not found.");

  const sceneRows = await sql`
    select s.id, s.title, s.description, s.aspect_ratio, s.duration_seconds, s.resolution,
      pv.version as prompt_version, pv.content as prompt
    from scenes s
    left join lateral (
      select version, content
      from scene_prompt_versions
      where scene_id = s.id
      order by version desc
      limit 1
    ) pv on true
    where s.project_id = ${projectId}
    order by s.created_at asc
  `;

  const assetRows = await sql`
    select id, type, filename, mime_type, width, height, duration_seconds, sha256
    from assets
    where project_id = ${projectId}
    order by created_at desc
    limit 100
  `;

  return {
    project: projectRows[0],
    scenes: Array.from(sceneRows),
    assets: Array.from(assetRows),
  };
}

export async function runProjectAgent(input: {
  projectId: string;
  apiProfileId?: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const resolved = await resolveGoogleProfile(input.apiProfileId ?? null);
  const google = createGoogleGenerativeAI({ apiKey: resolved.apiKey });
  const context = await getProjectContext(input.projectId);
  const sql = requireDb();

  const agent = new ToolLoopAgent({
    model: google("gemini-3.8-flash"),
    instructions: [
      "You are the project agent inside a persistent AI video workspace.",
      "The PostgreSQL project state is authoritative. Never imply a provider account owns the project.",
      "Never request, reveal, infer, or repeat API keys or credentials.",
      "Do not trigger paid video generation. Paid Veo generation requires the user's explicit Generate action in the UI.",
      "You may read project state, inspect assets/scenes, create a scene, or save a new prompt revision when the user clearly asks.",
      "Keep edits scoped strictly to this project.",
      "When making a scene or prompt edit, briefly state exactly what changed.",
      `Current project snapshot: ${JSON.stringify(context)}`,
    ].join("\n"),
    stopWhen: stepCountIs(8),
    tools: {
      getProject: tool({
        description: "Read the current project summary.",
        inputSchema: z.object({}),
        execute: async () => getProjectContext(input.projectId),
      }),
      listScenes: tool({
        description: "List scenes in the current project with their latest prompts and settings.",
        inputSchema: z.object({}),
        execute: async () => {
          const ctx = await getProjectContext(input.projectId);
          return ctx.scenes;
        },
      }),
      listAssets: tool({
        description: "List media assets belonging to the current project.",
        inputSchema: z.object({}),
        execute: async () => {
          const ctx = await getProjectContext(input.projectId);
          return ctx.assets;
        },
      }),
      createScene: tool({
        description: "Create a new scene in the current project.",
        inputSchema: z.object({ title: z.string().min(1).max(160) }),
        execute: async ({ title }) => createScene(input.projectId, title),
      }),
      savePrompt: tool({
        description: "Save a new prompt revision for an existing scene in the current project.",
        inputSchema: z.object({
          sceneId: z.string().uuid(),
          content: z.string().min(1).max(12000),
        }),
        execute: async ({ sceneId, content }) => {
          const sceneRows = await sql`
            select id from scenes
            where id = ${sceneId} and project_id = ${input.projectId}
            limit 1
          `;
          if (!sceneRows[0]) throw new Error("Scene does not belong to this project.");
          return savePromptVersion(sceneId, content, "agent");
        },
      }),
    },
  });

  const result = await agent.generate({ messages: input.messages });
  return {
    text: result.text,
    profileId: resolved.profile.id,
  };
}
