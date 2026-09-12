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

export type GenerationMode = "generate" | "extend";

export type GenerationAssetInput = {
  assetId: string;
  role: "initial_frame" | "last_frame" | "reference_asset" | "extension_source";
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
      | "INVALID_PROJECT"
      | "INVALID_SCENE"
      | "INVALID_INPUT_ASSET"
      | "INVALID_PARENT"
      | "EXTENSION_LIMIT"
      | "INVALID_EXTENSION_SOURCE",
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
  parent_generation_job_id: string | null;
  generation_mode: GenerationMode;
  extension_depth: number;
  expected_output_duration_seconds: number | null;
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
  output_asset_id?: string | null;
  output_filename?: string | null;
  output_r2_key?: string | null;
  output_relay_deleted_at?: string | Date | null;
  output_created_at?: string | Date | null;
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
  duration_seconds: number | null;
};

export type GenerationInputRecord = {
  asset_id: string;
  role: GenerationAssetInput["role"];
  sort_order: number;
  type: string;
  filename: string;
  mime_type: string | null;
  r2_key: string | null;
  relay_deleted_at: string | Date | null;
  sha256: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
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
  generationMode?: GenerationMode;
  parentGenerationJobId?: string | null;
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

    const generationMode: GenerationMode = input.generationMode ?? "generate";
    let parentGenerationJobId: string | null = null;
    let extensionDepth = 0;
    let expectedOutputDurationSeconds = input.durationSecondsSnapshot ?? 8;
    let sceneId = input.sceneId ?? null;
    let aspectRatio = input.aspectRatioSnapshot ?? "9:16";
    let durationSeconds = input.durationSecondsSnapshot ?? 8;
    let resolution = input.resolutionSnapshot ?? "720p";
    let effectiveAssetInputs = input.assetInputs ?? [];

    if (generationMode === "extend") {
      if (!input.parentGenerationJobId) {
        throw new GenerationSafetyError("INVALID_PARENT", "Video extension requires a parent generation job.");
      }
      if (effectiveAssetInputs.length) {
        throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Extension source is derived from the parent generation and cannot be supplied manually.");
      }

      const parentRows = await tx`
        select
          j.id,
          j.project_id,
          j.scene_id,
          j.aspect_ratio_snapshot,
          j.resolution_snapshot,
          j.extension_depth,
          coalesce(j.expected_output_duration_seconds, j.duration_seconds_snapshot) as expected_output_duration_seconds,
          j.status,
          a.id as output_asset_id,
          a.type as output_asset_type,
          a.mime_type as output_mime_type,
          a.r2_key as output_r2_key,
          a.relay_deleted_at as output_relay_deleted_at,
          a.created_at as output_created_at
        from generation_jobs j
        left join lateral (
          select a.*
          from generation_outputs go
          join assets a on a.id = go.asset_id
          where go.generation_job_id = j.id
          order by go.created_at desc
          limit 1
        ) a on true
        where j.id = ${input.parentGenerationJobId}
          and j.workspace_id = ${workspace.id}
          and j.project_id = ${input.projectId}
        limit 1
        for update of j
      `;
      const parent = parentRows[0];
      if (!parent) {
        throw new GenerationSafetyError("INVALID_PARENT", "Parent generation does not exist in this project.");
      }
      if (!["cloud_ready", "local_confirmed"].includes(String(parent.status))) {
        throw new GenerationSafetyError("INVALID_PARENT", "Only a completed Veo generation can be extended.");
      }
      if (String(parent.resolution_snapshot) !== "720p") {
        throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Only 720p Veo videos can be extended.");
      }

      const parentDuration = Number(parent.expected_output_duration_seconds ?? 0);
      if (!Number.isFinite(parentDuration) || parentDuration <= 0 || parentDuration > 141) {
        throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Extension source must be a Veo video no longer than 141 seconds.");
      }

      extensionDepth = Number(parent.extension_depth ?? 0) + 1;
      if (extensionDepth > 20) {
        throw new GenerationSafetyError("EXTENSION_LIMIT", "Veo supports at most 20 extensions in one generation chain.");
      }

      if (
        !parent.output_asset_id ||
        parent.output_asset_type !== "GENERATED_VIDEO" ||
        !String(parent.output_mime_type ?? "").startsWith("video/") ||
        !parent.output_r2_key ||
        parent.output_relay_deleted_at
      ) {
        throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "The parent Veo output is not available in the R2 relay for extension.");
      }

      parentGenerationJobId = String(parent.id);
      sceneId = sceneId ?? (parent.scene_id ? String(parent.scene_id) : null);
      aspectRatio = String(parent.aspect_ratio_snapshot ?? "9:16");
      durationSeconds = 8;
      resolution = "720p";
      expectedOutputDurationSeconds = parentDuration + 7;
      effectiveAssetInputs = [{
        assetId: String(parent.output_asset_id),
        role: "extension_source",
        sortOrder: 0,
      }];
    }

    if (sceneId) {
      const scenes = await tx`
        select id
        from scenes
        where id = ${sceneId} and project_id = ${input.projectId}
        limit 1
      `;
      if (!scenes[0]) {
        throw new GenerationSafetyError("INVALID_SCENE", "Selected scene does not belong to this project.");
      }
    }

    const inputSlots = new Set<string>();
    for (const item of effectiveAssetInputs) {
      const sortOrder = item.sortOrder ?? 0;
      const slot = `${item.role}:${sortOrder}`;
      if (inputSlots.has(slot)) {
        throw new GenerationSafetyError("INVALID_INPUT_ASSET", `Duplicate generation input slot ${slot}.`);
      }
      inputSlots.add(slot);

      const assets = await tx`
        select a.id, a.type, a.mime_type, a.r2_key, a.relay_deleted_at
        from assets a
        join projects p on p.id = a.project_id
        where a.id = ${item.assetId}
          and a.project_id = ${input.projectId}
          and p.workspace_id = ${workspace.id}
        limit 1
      `;
      const asset = assets[0];
      if (!asset) {
        throw new GenerationSafetyError("INVALID_INPUT_ASSET", `Asset ${item.assetId} does not belong to this project/workspace.`);
      }
      if (!asset.r2_key || asset.relay_deleted_at) {
        throw new GenerationSafetyError("INVALID_INPUT_ASSET", `Asset ${item.assetId} is not currently available in the R2 relay.`);
      }

      if (item.role === "extension_source") {
        if (asset.type !== "GENERATED_VIDEO" || !String(asset.mime_type ?? "").startsWith("video/")) {
          throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Extension source must be an app-recorded generated video.");
        }
      } else if (!String(asset.mime_type ?? "").startsWith("image/")) {
        throw new GenerationSafetyError("INVALID_INPUT_ASSET", `Asset ${item.assetId} is not a supported image input.`);
      }
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

    // A concurrent duplicate request may have passed the optimistic lookup
    // before this transaction acquired the workspace-settings lock. Re-check
    // under that serialization point so idempotent retries do not consume
    // budget or hit the unique constraint.
    const existingAfterLock = await tx`
      select *
      from generation_jobs
      where workspace_id = ${workspace.id}
        and generation_request_id = ${input.generationRequestId}
      limit 1
    `;
    if (existingAfterLock[0]) {
      return { job: existingAfterLock[0] as unknown as GenerationJobRecord, created: false };
    }

    // Extension reserves an 8-second 720p request. Google currently adds 7 seconds
    // to the source video, so this intentionally reserves spend conservatively.
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
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        )::int as daily_count,
        count(*) filter (
          where created_at >= date_trunc('month', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        )::int as monthly_count,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('day', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        ), 0)::numeric as daily_reserved_usd,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('month', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
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
        requested_api_profile_id, target_device_id,
        parent_generation_job_id, generation_mode, extension_depth, expected_output_duration_seconds,
        model_id, prompt_snapshot, aspect_ratio_snapshot, duration_seconds_snapshot,
        resolution_snapshot, estimated_cost_usd, pricing_version, status
      ) values (
        ${input.generationRequestId}, ${workspace.id}, ${input.projectId}, ${sceneId},
        ${input.requestedApiProfileId ?? null}, ${effectiveTargetDeviceId},
        ${parentGenerationJobId}, ${generationMode}, ${extensionDepth}, ${expectedOutputDurationSeconds},
        ${input.modelId}, ${input.promptSnapshot}, ${aspectRatio},
        ${durationSeconds}, ${resolution}, ${pricing.estimatedCostUsd}, ${pricing.pricingVersion}, 'queued'
      )
      on conflict (workspace_id, generation_request_id) do nothing
      returning *
    `;

    if (!rows[0]) {
      const raced = await tx`
        select *
        from generation_jobs
        where workspace_id = ${workspace.id}
          and generation_request_id = ${input.generationRequestId}
        limit 1
      `;
      if (raced[0]) {
        return { job: raced[0] as unknown as GenerationJobRecord, created: false };
      }
      throw new Error("Generation job insert lost an idempotency race without an existing row.");
    }

    const job = rows[0] as unknown as GenerationJobRecord;

    for (const item of effectiveAssetInputs) {
      await tx`
        insert into generation_job_assets (generation_job_id, asset_id, role, sort_order)
        values (${job.id}, ${item.assetId}, ${item.role}, ${item.sortOrder ?? 0})
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
           a.filename, a.relative_path, a.r2_key, a.sha256, a.file_size_bytes, a.duration_seconds
    from generation_outputs go
    join assets a on a.id = go.asset_id
    where go.generation_job_id = ${jobId}
    order by go.created_at asc
  `;
  const inputs = await sql`
    select gja.asset_id, gja.role, gja.sort_order,
      a.type, a.filename, a.mime_type, a.r2_key, a.relay_deleted_at,
      a.sha256, a.file_size_bytes, a.duration_seconds
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
        select j.*, s.title as scene_title,
          output.asset_id as output_asset_id,
          output.filename as output_filename,
          output.r2_key as output_r2_key,
          output.relay_deleted_at as output_relay_deleted_at,
          output.created_at as output_created_at
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        left join lateral (
          select a.id as asset_id, a.filename, a.r2_key, a.relay_deleted_at, go.created_at
          from generation_outputs go
          join assets a on a.id = go.asset_id
          where go.generation_job_id = j.id
          order by go.created_at desc
          limit 1
        ) output on true
        where j.workspace_id = ${workspace.id} and j.project_id = ${projectId}
        order by j.created_at desc limit 50
      `
    : await sql`
        select j.*, s.title as scene_title,
          output.asset_id as output_asset_id,
          output.filename as output_filename,
          output.r2_key as output_r2_key,
          output.relay_deleted_at as output_relay_deleted_at,
          output.created_at as output_created_at
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        left join lateral (
          select a.id as asset_id, a.filename, a.r2_key, a.relay_deleted_at, go.created_at
          from generation_outputs go
          join assets a on a.id = go.asset_id
          where go.generation_job_id = j.id
          order by go.created_at desc
          limit 1
        ) output on true
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
    // Serialize output persistence per logical generation. If an Inngest step
    // is replayed after the first transaction committed, return the existing
    // output instead of inserting a second generated asset.
    const jobs = await tx`
      select expected_output_duration_seconds
      from generation_jobs
      where id = ${input.jobId} and project_id = ${input.projectId}
      limit 1
      for update
    `;
    if (!jobs[0]) throw new Error("Generation job not found while saving relay output.");

    const existing = await tx`
      select a.*
      from generation_outputs go
      join assets a on a.id = go.asset_id
      where go.generation_job_id = ${input.jobId}
      order by go.created_at asc
      limit 1
    `;
    if (existing[0]) return existing[0];

    const assets = await tx`
      insert into assets (
        project_id, type, filename, mime_type, r2_key, sha256, file_size_bytes, duration_seconds
      ) values (
        ${input.projectId}, 'GENERATED_VIDEO', ${input.filename}, 'video/mp4', ${input.r2Key},
        ${input.sha256}, ${input.fileSizeBytes}, ${jobs[0].expected_output_duration_seconds ?? null}
      )
      returning *
    `;
    await tx`
      insert into generation_outputs (generation_job_id, asset_id)
      values (${input.jobId}, ${assets[0].id})
    `;
    return assets[0];
  });
}
