import { requireDb } from "./db";
import { runGenerationPreflight, type GenerationPreflightResult } from "./generation-preflight";
import { getGenerationJob } from "./generations";
import { validateVeoSettings } from "./model-registry";
import { ensurePersonalWorkspace } from "./workspace";

export type ExtensionPreflightResult = {
  ok: boolean;
  parentJobId: string;
  expectedOutputDurationSeconds: number | null;
  extensionDepth: number | null;
  sourceReferenceExpiresAt: string | null;
  checks: Array<{ code: string; ok: boolean; message: string }>;
  generation: GenerationPreflightResult | null;
};

export async function runExtensionPreflight(input: {
  parentJobId: string;
  modelId: string;
  requestedApiProfileId?: string | null;
  targetDeviceId?: string | null;
}): Promise<ExtensionPreflightResult> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const checks: ExtensionPreflightResult["checks"] = [];

  const parent = await getGenerationJob(input.parentJobId);
  if (!parent || parent.workspace_id !== workspace.id) {
    return {
      ok: false,
      parentJobId: input.parentJobId,
      expectedOutputDurationSeconds: null,
      extensionDepth: null,
      sourceReferenceExpiresAt: null,
      checks: [{ code: "PARENT", ok: false, message: "Parent generation was not found in this workspace." }],
      generation: null,
    };
  }

  const capabilityError = validateVeoSettings({
    modelId: input.modelId,
    resolution: "720p",
    durationSeconds: 8,
    aspectRatio: parent.aspect_ratio_snapshot,
    isExtension: true,
  });
  checks.push({
    code: "EXTENSION_MODEL",
    ok: !capabilityError,
    message: capabilityError ?? "Selected model supports 720p video extension.",
  });

  const completed = ["cloud_ready", "local_confirmed"].includes(parent.status);
  checks.push({
    code: "PARENT_STATUS",
    ok: completed,
    message: completed ? "Parent generation is complete." : `Parent generation is ${parent.status.replaceAll("_", " ")}.`,
  });

  const sourceResolutionOk = parent.resolution_snapshot === "720p";
  checks.push({
    code: "SOURCE_RESOLUTION",
    ok: sourceResolutionOk,
    message: sourceResolutionOk ? "Source is 720p." : "Only 720p Veo outputs can be extended.",
  });

  const depth = Number(parent.extension_depth ?? 0);
  const depthOk = depth < 20;
  checks.push({
    code: "EXTENSION_DEPTH",
    ok: depthOk,
    message: depthOk ? `Extension depth ${depth}/20.` : "This lineage already reached the 20-extension limit.",
  });

  const parentDuration = Number(parent.expected_output_duration_seconds ?? parent.duration_seconds_snapshot ?? 0);
  const durationOk = Number.isFinite(parentDuration) && parentDuration > 0 && parentDuration <= 141;
  checks.push({
    code: "SOURCE_DURATION",
    ok: durationOk,
    message: durationOk
      ? `${parentDuration}s source will become approximately ${parentDuration + 7}s after this extension.`
      : "Extension source must be a Veo video no longer than 141 seconds.",
  });

  const sourceRows = await sql`
    select
      a.id,
      a.type,
      a.mime_type,
      a.r2_key,
      a.relay_deleted_at,
      a.created_at,
      a.veo_reference_refreshed_at,
      coalesce(a.veo_reference_refreshed_at, a.created_at) + interval '2 days' as reference_expires_at,
      coalesce(a.veo_reference_refreshed_at, a.created_at) >= now() - interval '2 days' as reference_fresh
    from generation_outputs go
    join assets a on a.id = go.asset_id
    where go.generation_job_id = ${parent.id}
    order by go.created_at desc
    limit 1
  `;
  const source = sourceRows[0];

  const sourceRecorded = Boolean(
    source &&
      source.type === "GENERATED_VIDEO" &&
      String(source.mime_type ?? "").startsWith("video/") &&
      source.r2_key &&
      !source.relay_deleted_at,
  );
  checks.push({
    code: "SOURCE_RELAY",
    ok: sourceRecorded,
    message: sourceRecorded
      ? "Generated source is available in the R2 relay."
      : "The generated source is not available in R2 for provider extension.",
  });

  const referenceFresh = Boolean(source?.reference_fresh);
  checks.push({
    code: "SOURCE_REFERENCE_WINDOW",
    ok: referenceFresh,
    message: referenceFresh
      ? `Provider extension reference is currently fresh until ${new Date(source.reference_expires_at).toISOString()}.`
      : "The source is outside Google's current two-day extension reference window.",
  });

  let generation: GenerationPreflightResult | null = null;
  if (parent.project_id) {
    generation = await runGenerationPreflight({
      projectId: parent.project_id,
      requestedApiProfileId: input.requestedApiProfileId ?? parent.requested_api_profile_id ?? null,
      targetDeviceId: input.targetDeviceId ?? parent.target_device_id ?? null,
      modelId: input.modelId,
      aspectRatio: parent.aspect_ratio_snapshot,
      durationSeconds: 8,
      resolution: "720p",
    });
  }

  const allChecks = [
    ...checks,
    ...(generation?.checks.map((check) => ({ ...check, code: `GENERATION_${check.code}` })) ?? []),
  ];

  return {
    ok: allChecks.every((check) => check.ok),
    parentJobId: parent.id,
    expectedOutputDurationSeconds: durationOk ? parentDuration + 7 : null,
    extensionDepth: depth,
    sourceReferenceExpiresAt: source?.reference_expires_at ? new Date(source.reference_expires_at).toISOString() : null,
    checks: allChecks,
    generation,
  };
}
