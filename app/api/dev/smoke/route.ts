import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireDb } from "@/lib/db";
import { createGenerationJob } from "@/lib/generations";
import { ensurePersonalWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  let projectId: string | null = null;

  try {
    const projectRows = await sql`
      insert into projects (workspace_id, name, description)
      values (${workspace.id}, ${`Smoke Test ${Date.now()}`}, 'Temporary local development smoke test')
      returning id
    `;
    projectId = String(projectRows[0].id);

    const sceneRows = await sql`
      insert into scenes (project_id, title, description, aspect_ratio, duration_seconds, resolution)
      values (${projectId}, 'Smoke Scene', 'Temporary smoke-test scene', '9:16', 4, '720p')
      returning id
    `;
    const sceneId = String(sceneRows[0].id);

    const promptRows = await sql`
      insert into scene_prompt_versions (scene_id, version, content, created_by)
      values (${sceneId}, 1, 'Local smoke-test prompt. No provider call should occur.', 'system')
      returning id
    `;

    const generationRequestId = randomUUID();
    const first = await createGenerationJob({
      generationRequestId,
      projectId,
      sceneId,
      modelId: "veo-3.1-lite-generate-preview",
      promptSnapshot: "Local smoke-test prompt. No provider call should occur.",
      aspectRatioSnapshot: "9:16",
      durationSecondsSnapshot: 4,
      resolutionSnapshot: "720p",
    });
    const second = await createGenerationJob({
      generationRequestId,
      projectId,
      sceneId,
      modelId: "veo-3.1-lite-generate-preview",
      promptSnapshot: "This retry must return the original logical job.",
      aspectRatioSnapshot: "9:16",
      durationSecondsSnapshot: 4,
      resolutionSnapshot: "720p",
    });

    if (!first.created || second.created || first.job.id !== second.job.id) {
      throw new Error("Generation idempotency verification failed.");
    }

    const readback = await sql`
      select
        p.id as project_id,
        s.id as scene_id,
        spv.id as prompt_version_id,
        gj.id as generation_job_id
      from projects p
      join scenes s on s.project_id = p.id
      join scene_prompt_versions spv on spv.scene_id = s.id
      join generation_jobs gj on gj.project_id = p.id
      where p.id = ${projectId}
      limit 1
    `;

    if (!readback[0]) throw new Error("Persistence readback verification failed.");

    return NextResponse.json({
      ok: true,
      checks: {
        workspace: true,
        projectCrud: true,
        sceneCrud: true,
        promptVersionPersistence: Boolean(promptRows[0]?.id),
        generationIdempotency: true,
        providerCalled: false,
      },
      temporary: {
        projectId,
        sceneId,
        generationJobId: first.job.id,
      },
    });
  } catch (error) {
    console.error("Local smoke test failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Local smoke test failed" },
      { status: 500 },
    );
  } finally {
    if (projectId) {
      await sql`delete from projects where id = ${projectId}`.catch((error) => {
        console.error("Failed to clean temporary smoke-test project", error);
      });
    }
  }
}
