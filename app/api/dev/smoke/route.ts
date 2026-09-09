import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireDb } from "@/lib/db";
import { assertExtensionSourceFresh } from "@/lib/extensions";
import { createGenerationJob, GenerationSafetyError } from "@/lib/generations";
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

    // Synthesize a provider-completed Veo output in PostgreSQL only. No Google,
    // Inngest, or R2 network call occurs in this development smoke test.
    await sql`
      update generation_jobs
      set status = 'cloud_ready', expected_output_duration_seconds = 4, updated_at = now()
      where id = ${first.job.id}
    `;

    const outputRows = await sql`
      insert into assets (
        project_id, type, filename, mime_type, r2_key, relay_delete_after,
        sha256, file_size_bytes, duration_seconds, veo_reference_refreshed_at
      ) values (
        ${projectId}, 'GENERATED_VIDEO', 'smoke-base.mp4', 'video/mp4',
        ${`smoke/${first.job.id}/base.mp4`}, now() + interval '24 hours',
        ${"a".repeat(64)}, 1024, 4, now()
      )
      returning id
    `;
    const outputAssetId = String(outputRows[0].id);

    await sql`
      insert into generation_outputs (generation_job_id, asset_id)
      values (${first.job.id}, ${outputAssetId})
    `;

    await assertExtensionSourceFresh(first.job.id);
    const pinRows = await sql`
      select relay_delete_after >= now() + interval '47 hours' as pinned
      from assets
      where id = ${outputAssetId}
      limit 1
    `;
    const extensionSourcePinned = Boolean(pinRows[0]?.pinned);
    if (!extensionSourcePinned) throw new Error("Extension source relay pin verification failed.");

    const extension = await createGenerationJob({
      generationRequestId: randomUUID(),
      projectId,
      sceneId,
      modelId: "veo-3.1-generate-preview",
      promptSnapshot: "Continue the smoke-test action naturally.",
      aspectRatioSnapshot: "9:16",
      durationSecondsSnapshot: 8,
      resolutionSnapshot: "720p",
      generationMode: "extend",
      parentGenerationJobId: first.job.id,
    });

    if (!extension.created) throw new Error("Extension lineage job was not created.");

    const extensionRows = await sql`
      select
        j.parent_generation_job_id,
        j.generation_mode,
        j.extension_depth,
        j.expected_output_duration_seconds,
        j.duration_seconds_snapshot,
        j.resolution_snapshot,
        gja.asset_id as extension_source_asset_id,
        gja.role as extension_source_role
      from generation_jobs j
      left join generation_job_assets gja
        on gja.generation_job_id = j.id
        and gja.role = 'extension_source'
      where j.id = ${extension.job.id}
      limit 1
    `;
    const extensionReadback = extensionRows[0];

    const extensionLineage = Boolean(
      extensionReadback &&
      String(extensionReadback.parent_generation_job_id) === first.job.id &&
      extensionReadback.generation_mode === "extend" &&
      Number(extensionReadback.extension_depth) === 1 &&
      Number(extensionReadback.expected_output_duration_seconds) === 11 &&
      Number(extensionReadback.duration_seconds_snapshot) === 8 &&
      extensionReadback.resolution_snapshot === "720p" &&
      String(extensionReadback.extension_source_asset_id) === outputAssetId &&
      extensionReadback.extension_source_role === "extension_source"
    );
    if (!extensionLineage) throw new Error("Extension lineage persistence verification failed.");

    // Verify the hard 20-extension limit using a synthetic completed parent at depth 20.
    await sql`
      update generation_jobs
      set status = 'cloud_ready',
          extension_depth = 20,
          expected_output_duration_seconds = 100,
          resolution_snapshot = '720p'
      where id = ${extension.job.id}
    `;
    const deepOutputRows = await sql`
      insert into assets (
        project_id, type, filename, mime_type, r2_key, sha256,
        file_size_bytes, duration_seconds, veo_reference_refreshed_at
      ) values (
        ${projectId}, 'GENERATED_VIDEO', 'smoke-depth-20.mp4', 'video/mp4',
        ${`smoke/${extension.job.id}/depth20.mp4`}, ${"b".repeat(64)}, 2048, 100, now()
      )
      returning id
    `;
    await sql`
      insert into generation_outputs (generation_job_id, asset_id)
      values (${extension.job.id}, ${deepOutputRows[0].id})
    `;

    let extensionLimit = false;
    try {
      await createGenerationJob({
        generationRequestId: randomUUID(),
        projectId,
        sceneId,
        modelId: "veo-3.1-generate-preview",
        promptSnapshot: "This extension must be rejected before any provider work.",
        aspectRatioSnapshot: "9:16",
        durationSecondsSnapshot: 8,
        resolutionSnapshot: "720p",
        generationMode: "extend",
        parentGenerationJobId: extension.job.id,
      });
    } catch (error) {
      extensionLimit = error instanceof GenerationSafetyError && error.code === "EXTENSION_LIMIT";
    }
    if (!extensionLimit) throw new Error("Twenty-extension hard limit verification failed.");

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
        extensionSourcePinned,
        extensionLineage,
        extensionLimit,
        providerCalled: false,
      },
      temporary: {
        projectId,
        sceneId,
        generationJobId: first.job.id,
        extensionJobId: extension.job.id,
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
