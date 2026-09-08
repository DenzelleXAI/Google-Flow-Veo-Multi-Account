import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type GenerationStatus =
  | "queued"
  | "submitting"
  | "provider_pending"
  | "downloading_from_provider"
  | "uploading_relay"
  | "cloud_ready"
  | "failed_ambiguous"
  | "failed_retryable"
  | "failed_final"
  | "cancelled";

export type GenerationAssetInput = {
  assetId: string;
  role: "initial_frame" | "last_frame" | "reference_asset";
  sortOrder?: number;
};

export async function createGenerationJob(input: {
  generationRequestId: string;
  projectId: string;
  sceneId?: string | null;
  requestedApiProfileId?: string | null;
  targetDeviceId?: string | null;
  modelId: string;
  promptSnapshot: string;
  aspectRatioSnapshot?: string | null;
  durationSecondsSnapshot?: number | null;
  resolutionSnapshot?: string | null;
  assetInputs?: GenerationAssetInput[];
}) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql.begin(async (tx) => {
    const existing = await tx`
      select *
      from generation_jobs
      where workspace_id = ${workspace.id}
        and generation_request_id = ${input.generationRequestId}
      limit 1
    `;

    if (existing[0]) return { job: existing[0], created: false };

    const rows = await tx`
      insert into generation_jobs (
        generation_request_id, workspace_id, project_id, scene_id,
        requested_api_profile_id, target_device_id, model_id,
        prompt_snapshot, aspect_ratio_snapshot, duration_seconds_snapshot,
        resolution_snapshot, status
      ) values (
        ${input.generationRequestId}, ${workspace.id}, ${input.projectId}, ${input.sceneId ?? null},
        ${input.requestedApiProfileId ?? null}, ${input.targetDeviceId ?? null}, ${input.modelId},
        ${input.promptSnapshot}, ${input.aspectRatioSnapshot ?? "9:16"},
        ${input.durationSecondsSnapshot ?? null}, ${input.resolutionSnapshot ?? null}, 'queued'
      )
      returning *
    `;

    for (const item of input.assetInputs ?? []) {
      await tx`
        insert into generation_job_assets (generation_job_id, asset_id, role, sort_order)
        select ${rows[0].id}, a.id, ${item.role}, ${item.sortOrder ?? 0}
        from assets a
        where a.id = ${item.assetId} and a.project_id = ${input.projectId}
      `;
    }

    return { job: rows[0], created: true };
  });
}

export async function getGenerationJob(jobId: string) {
  const sql = requireDb();
  const rows = await sql`
    select j.*, p.name as project_name, s.title as scene_title
    from generation_jobs j
    join projects p on p.id = j.project_id
    left join scenes s on s.id = j.scene_id
    where j.id = ${jobId}
    limit 1
  `;
  if (!rows[0]) return null;

  const attempts = await sql`
    select * from generation_attempts
    where generation_job_id = ${jobId}
    order by started_at asc
  `;
  const outputs = await sql`
    select go.id, go.asset_id, go.created_at,
           a.filename, a.relative_path, a.r2_key, a.sha256, a.file_size_bytes
    from generation_outputs go
    join assets a on a.id = go.asset_id
    where go.generation_job_id = ${jobId}
    order by go.created_at asc
  `;
  const inputs = await sql`
    select gja.asset_id, gja.role, gja.sort_order,
      a.filename, a.mime_type, a.r2_key, a.sha256, a.file_size_bytes
    from generation_job_assets gja
    join assets a on a.id = gja.asset_id
    where gja.generation_job_id = ${jobId}
    order by gja.role asc, gja.sort_order asc
  `;
  return { ...rows[0], attempts, outputs, inputs };
}

export async function listRecentGenerationJobs(projectId?: string | null) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  return projectId
    ? sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id} and j.project_id = ${projectId}
        order by j.created_at desc limit 50
      `
    : sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id}
        order by j.created_at desc limit 50
      `;
}

export async function updateGenerationStatus(jobId: string, status: GenerationStatus) {
  const sql = requireDb();
  const rows = await sql`
    update generation_jobs set status = ${status}, updated_at = now()
    where id = ${jobId} returning *
  `;
  return rows[0] ?? null;
}

export async function startAttempt(jobId: string, apiProfileId: string | null, modelId: string) {
  const sql = requireDb();
  const rows = await sql`
    insert into generation_attempts (generation_job_id, api_profile_id, provider, model_id, status)
    values (${jobId}, ${apiProfileId}, 'google', ${modelId}, 'submitting')
    returning *
  `;
  return rows[0];
}

export async function updateAttempt(input: {
  attemptId: string;
  status: string;
  providerOperationId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  completed?: boolean;
}) {
  const sql = requireDb();
  const rows = await sql`
    update generation_attempts
    set status = ${input.status},
        provider_operation_id = coalesce(${input.providerOperationId ?? null}, provider_operation_id),
        error_code = ${input.errorCode ?? null},
        error_message = ${input.errorMessage ?? null},
        completed_at = case when ${input.completed ?? false} then now() else completed_at end
    where id = ${input.attemptId}
    returning *
  `;
  return rows[0] ?? null;
}

export async function saveRelayOutput(input: {
  jobId: string;
  projectId: string;
  filename: string;
  r2Key: string;
  sha256: string;
  fileSizeBytes: number;
}) {
  const sql = requireDb();
  return sql.begin(async (tx) => {
    const assets = await tx`
      insert into assets (project_id, type, filename, mime_type, r2_key, sha256, file_size_bytes)
      values (${input.projectId}, 'GENERATED_VIDEO', ${input.filename}, 'video/mp4', ${input.r2Key}, ${input.sha256}, ${input.fileSizeBytes})
      returning *
    `;
    await tx`
      insert into generation_outputs (generation_job_id, asset_id)
      values (${input.jobId}, ${assets[0].id})
      on conflict do nothing
    `;
    return assets[0];
  });
}
