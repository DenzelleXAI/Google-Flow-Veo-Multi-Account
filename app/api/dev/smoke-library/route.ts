import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { listWorkspaceAssets } from "@/lib/asset-library";
import { requireDb } from "@/lib/db";
import { upsertAssetLocation } from "@/lib/devices";
import { getGenerationMediaState } from "@/lib/generation-media";
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
  let deviceId: string | null = null;

  try {
    const projects = await sql`
      insert into projects (workspace_id, name, description)
      values (${workspace.id}, ${`Asset Smoke ${Date.now()}`}, 'Temporary asset/media smoke test')
      returning id
    `;
    projectId = String(projects[0].id);

    const devices = await sql`
      insert into devices (
        workspace_id, name, platform, media_root, free_disk_bytes, last_seen_at, status
      ) values (
        ${workspace.id}, ${`CI Device ${Date.now()}`}, 'ci/linux', '/tmp/flow-media',
        ${100 * 1024 ** 3}, now(), 'online'
      )
      returning id
    `;
    deviceId = String(devices[0].id);

    const jobResult = await createGenerationJob({
      generationRequestId: randomUUID(),
      projectId,
      targetDeviceId: deviceId,
      modelId: "veo-3.1-lite-generate-preview",
      promptSnapshot: "Asset library smoke test. No provider call.",
      aspectRatioSnapshot: "9:16",
      durationSecondsSnapshot: 4,
      resolutionSnapshot: "720p",
    });
    const jobId = String(jobResult.job.id);

    await sql`
      update generation_jobs
      set status = 'cloud_ready', expected_output_duration_seconds = 4, updated_at = now()
      where id = ${jobId}
    `;

    const expectedHash = "c".repeat(64);
    const assets = await sql`
      insert into assets (
        project_id, type, filename, mime_type, r2_key, sha256,
        file_size_bytes, width, height, duration_seconds
      ) values (
        ${projectId}, 'GENERATED_VIDEO', 'asset-library-smoke.mp4', 'video/mp4',
        ${`smoke/${jobId}/asset-library-smoke.mp4`}, ${expectedHash},
        4096, 720, 1280, 4
      )
      returning id
    `;
    const assetId = String(assets[0].id);

    await sql`
      insert into generation_outputs (generation_job_id, asset_id)
      values (${jobId}, ${assetId})
    `;

    await upsertAssetLocation({
      assetId,
      deviceId,
      relativePath: `media/${workspace.id}/outputs/${jobId}/${assetId}.mp4`,
      status: "verified",
      expectedHash,
      verifiedHash: expectedHash,
      fileSizeBytes: 4096,
    });

    const library = await listWorkspaceAssets(projectId);
    const libraryItem = library.find((item) => item.id === assetId);
    if (!libraryItem) throw new Error("Asset Library did not return the generated asset.");
    if (libraryItem.replica_count !== 1 || libraryItem.verified_replica_count !== 1) {
      throw new Error("Asset Library replica aggregation is incorrect.");
    }

    const media = await getGenerationMediaState(jobId);
    const mediaOutput = media?.outputs.find((output) => output.asset_id === assetId);
    if (!media || !mediaOutput) throw new Error("Generation media locality did not return the output asset.");
    if (media.jobStatus !== "local_confirmed") {
      throw new Error(`Expected local_confirmed after verified target replica, got ${media.jobStatus}.`);
    }
    if (mediaOutput.replicas.length !== 1) throw new Error("Generation media replica count is incorrect.");
    const replica = mediaOutput.replicas[0];
    if (replica.status !== "verified" || replica.verified_hash !== expectedHash) {
      throw new Error("Generation media verified replica state is incorrect.");
    }
    if (!mediaOutput.relay_delete_after || mediaOutput.relay_deleted_at) {
      throw new Error("Verified target replica did not schedule the expected R2 cleanup grace window.");
    }

    return NextResponse.json({
      ok: true,
      checks: {
        assetLibraryListing: true,
        assetReplicaAggregation: true,
        generationMediaLocality: true,
        targetReplicaConfirmation: true,
        relayCleanupScheduled: true,
        providerCalled: false,
      },
      temporary: { projectId, deviceId, jobId, assetId },
    });
  } catch (error) {
    console.error("Asset/media smoke test failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset/media smoke test failed" },
      { status: 500 },
    );
  } finally {
    if (projectId) {
      await sql`delete from projects where id = ${projectId}`.catch((error) => {
        console.error("Failed to clean asset smoke project", error);
      });
    }
    if (deviceId) {
      await sql`delete from devices where id = ${deviceId}`.catch((error) => {
        console.error("Failed to clean asset smoke device", error);
      });
    }
  }
}
