import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";
import { estimateVeoCostUsd } from "./veo-pricing";

export type GenerationStatus =
  | "queued"
  | "submitting"
  | "provider_pending"
  | "downloading_from_provider"
  | "uploading_relay"
  | "cloud_ready"
  | "local_confirmed"
  | "failed_ambiguous"
  | "failed_retryable"
  | "failed_final"
  | "cancelled";

export type GenerationAssetInput = {
  assetId: string;
  role: "initial_frame" | "last_frame" | "reference_asset";
  sortOrder?: number;
};

export class GenerationSafetyError extends Error {
  constructor(
    public readonly code:
      | "DAILY_LIMIT"
      | "MONTHLY_LIMIT"
      | "PER_REQUEST_SPEND_LIMIT"
      | "DAILY_SPEND_LIMIT"
      | "MONTHLY_SPEND_LIMIT"
      | "LOW_DISK"
      | "INVALID_DEVICE"
      | "INVALID_PROJECT",
    message: string,
  ) {
    super(message);
    this.name = "GenerationSafetyError";
  }
}

export type GenerationJobRecord = {
  id: string;
  generation_request_id: string;
  workspace_id: string;
  project_id: string;
  scene_id: string | null;
  requested_api_profile_id: string | null;
  target_device_id: string | null;
  model_id: string;
  prompt_snapshot: string;
  aspect_ratio_snapshot: string;
  duration_seconds_snapshot: number | null;
  resolution_snapshot: string | null;
  estimated_cost_usd: number | null;
  pricing_version: string | null;
  status: GenerationStatus;
  project_name?: string;
  scene_title?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export type GenerationAttemptRecord = {
  id: string;
  generation_job_id: string;
  api_profile_id: string | null;
  provider: string;
  model_id: string;
  provider_operation_id: string | null;
  status: string;
  started_at: string | Date;
  completed_at: string | Date | null;
  error_code: string | null;
  error_message: string | null;
};

export type GenerationOutputRecord = {
  id: string;
  asset_id: string;
  created_at: string | Date;
  filename: string;
  relative_path: string | null;
  r2_key: string | null;
  sha256: string | null;
  file_size_bytes: number | null;
};

export type GenerationInputRecord = {
  asset_id: string;
  role: GenerationAssetInput["role"];
  sort_order: number;
  filename: string;
  mime_type: string | null;
  r2_key: string | null;
  sha256: string | null;
  file_size_bytes: number | null;
};

export type GenerationJobDetail = GenerationJobRecord & {
  attempts: GenerationAttemptRecord[];
  outputs: GenerationOutputRecord[];
  inputs: GenerationInputRecord[];
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

    if (existing[0]) {
      return { job: existing[0] as unknown as GenerationJobRecord, created: false };
    }

    const projects = await tx`
      select id from projects
      where id = ${input.projectId} and workspace_id = ${workspace.id}
      limit 1
    `;
    if (!projects[0]) {
      throw new GenerationSafetyError("INVALID_PROJECT", "Project does not belong to this workspace.");
    }

    await tx`
      insert into workspace_settings (workspace_id)
      values (${workspace.id})
      on conflict (workspace_id) do nothing
    `;

    const settingsRows = await tx`
      select workspace_id, default_target_device_id, daily_generation_limit,
             monthly_generation_limit, daily_spend_limit_usd, monthly_spend_limit_usd,
             per_request_spend_limit_usd, min_free_disk_bytes, device_stale_after_seconds
      from workspace_settings
      where workspace_id = ${workspace.id}
      for update
    `;
    const settings = settingsRows[0];

    const durationSeconds = input.durationSecondsSnapshot ?? 8;
    const resolution = input.resolutionSnapshot ?? "720p";
    const pricing = estimateVeoCostUsd({
      modelId: input.modelId,
      resolution,
      durationSeconds,
    });

    if (pricing.estimatedCostUsd > Number(settings.per_request_spend_limit_usd)) {
      throw new GenerationSafetyError(
        "PER_REQUEST_SPEND_LIMIT",
        `Estimated cost $${pricing.estimatedCostUsd.toFixed(2)} exceeds the per-request cap of $${Number(settings.per_request_spend_limit_usd).toFixed(2)}.`,
      );
    }

    const usageRows = await tx`
      select
        count(*) filter (
          where created_at >= date_trunc('day', now())
            and status not in ('cancelled', 'failed_final')
        )::int as daily_count,
        count(*) filter (
          where created_at >= date_trunc('month', now())
            and status not in ('cancelled', 'failed_final')
        )::int as monthly_count,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('day', now())
            and status not in ('cancelled', 'failed_final')
        ), 0)::numeric as daily_reserved_usd,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('month', now())
            and status not in ('cancelled', 'failed_final')
        ), 0)::numeric as monthly_reserved_usd
      from generation_jobs
      where workspace_id = ${workspace.id}
    `;
    const usage = usageRows[0];

    if (Number(usage.daily_count) >= Number(settings.daily_generation_limit)) {
      throw new GenerationSafetyError(
        "DAILY_LIMIT",
        `Daily generation limit reached (${settings.daily_generation_limit}).`,
      );
    }
    if (Number(usage.monthly_count) >= Number(settings.monthly_generation_limit)) {
      throw new GenerationSafetyError(
        "MONTHLY_LIMIT",
        `Monthly generation limit reached (${settings.monthly_generation_limit}).`,
      );
    }

    const projectedDailyUsd = Number(usage.daily_reserved_usd) + pricing.estimatedCostUsd;
    const projectedMonthlyUsd = Number(usage.monthly_reserved_usd) + pricing.estimatedCostUsd;

    if (projectedDailyUsd > Number(settings.daily_spend_limit_usd)) {
      throw new GenerationSafetyError(
        "DAILY_SPEND_LIMIT",
        `This request would reserve $${projectedDailyUsd.toFixed(2)} today, above the $${Number(settings.daily_spend_limit_usd).toFixed(2)} daily cap.`,
      );
    }
    if (projectedMonthlyUsd > Number(settings.monthly_spend_limit_usd)) {
      throw new GenerationSafetyError(
        "MONTHLY_SPEND_LIMIT",
        `This request would reserve $${projectedMonthlyUsd.toFixed(2)} this month, above the $${Number(settings.monthly_spend_limit_usd).toFixed(2)} monthly cap.`,
      );
    }

    const effectiveTargetDeviceId = input.targetDeviceId ?? settings.default_target_device_id ?? null;
    if (effectiveTargetDeviceId) {
      const devices = await tx`
        select id, name, free_disk_bytes, last_seen_at, status,
          extract(epoch from (now() - last_seen_at))::int as seconds_since_seen
        from devices
        where id = ${effectiveTargetDeviceId} and workspace_id = ${workspace.id}
        limit 1
      `;
      const device = devices[0];
      if (!device) {
        throw new GenerationSafetyError("INVALID_DEVICE", "Selected target device does not exist in this workspace.");
      }

      const isFresh = device.last_seen_at && Number(device.seconds_since_seen) <= Number(settings.device_stale_after_seconds);
      if (
        isFresh &&
        device.free_disk_bytes !== null &&
        Number(device.free_disk_bytes) < Number(settings.min_free_disk_bytes)
      ) {
        const freeGb = (Number(device.free_disk_bytes) / 1024 ** 3).toFixed(1);
        const reserveGb = (Number(settings.min_free_disk_bytes) / 1024 ** 3).toFixed(0);
        throw new GenerationSafetyError(
          "LOW_DISK",
          `${device.name} has ${freeGb} GB free. At least ${reserveGb} GB must remain available.`,
        );
      }
    }

    const rows = await tx`
      insert into generation_jobs (
        generation_request_id, workspace_id, project_id, scene_id,
        requested_api_profile_id, target_device_id, model_id,
        prompt_snapshot, aspect_ratio_snapshot, duration_seconds_snapshot,
        resolution_snapshot, estimated_cost_usd, pricing_version, status
      ) values (
        ${input.generationRequestId}, ${workspace.id}, ${input.projectId}, ${input.sceneId ?? null},
        ${input.requestedApiProfileId ?? null}, ${effectiveTargetDeviceId}, ${input.modelId},
        ${input.promptSnapshot}, ${input.aspectRatioSnapshot ?? "9:16"},
        ${durationSeconds}, ${resolution}, ${pricing.estimatedCostUsd}, ${pricing.pricingVersion}, 'queued'
      )
      returning *
    `;

    const job = rows[0] as unknown as GenerationJobRecord;

    for (const item of input.assetInputs ?? []) {
      await tx`
        insert into generation_job_assets (generation_job_id, asset_id, role, sort_order)
        select ${job.id}, a.id, ${item.role}, ${item.sortOrder ?? 0}
        from assets a
        where a.id = ${item.assetId} and a.project_id = ${input.projectId}
      `;
    }

    return { job, created: true };
  });
}

export async function getGenerationJob(jobId: string): Promise<GenerationJobDetail | null> {
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

  const job = rows[0] as unknown as GenerationJobRecord;

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

  return {
    ...job,
    attempts: Array.from(attempts) as unknown as GenerationAttemptRecord[],
    outputs: Array.from(outputs) as unknown as GenerationOutputRecord[],
    inputs: Array.from(inputs) as unknown as GenerationInputRecord[],
  };
}

export async function listRecentGenerationJobs(projectId?: string | null) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = projectId
    ? await sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id} and j.project_id = ${projectId}
        order by j.created_at desc limit 50
      `
    : await sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id}
        order by j.created_at desc limit 50
      `;

  return Array.from(rows) as unknown as GenerationJobRecord[];
}

export async function updateGenerationStatus(jobId: string, status: GenerationStatus) {
  const sql = requireDb();
  const rows = await sql`
    update generation_jobs set status = ${status}, updated_at = now()
    where id = ${jobId} returning *
  `;
  return (rows[0] as unknown as GenerationJobRecord | undefined) ?? null;
}

export async function startAttempt(jobId: string, apiProfileId: string | null, modelId: string) {
  const sql = requireDb();
  const rows = await sql`
    insert into generation_attempts (generation_job_id, api_profile_id, provider, model_id, status)
    values (${jobId}, ${apiProfileId}, 'google', ${modelId}, 'submitting')
    returning *
  `;
  return rows[0] as unknown as GenerationAttemptRecord;
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
  return (rows[0] as unknown as GenerationAttemptRecord | undefined) ?? null;
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
