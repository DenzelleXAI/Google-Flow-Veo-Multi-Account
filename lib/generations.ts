import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export async function createGenerationJob(input: {
  generationRequestId: string;
  projectId: string;
  sceneId?: string | null;
  requestedApiProfileId?: string | null;
  targetDeviceId?: string | null;
  modelId: string;
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
      return { job: existing[0], created: false };
    }

    const rows = await tx`
      insert into generation_jobs (
        generation_request_id, workspace_id, project_id, scene_id,
        requested_api_profile_id, target_device_id, model_id, status
      ) values (
        ${input.generationRequestId}, ${workspace.id}, ${input.projectId}, ${input.sceneId ?? null},
        ${input.requestedApiProfileId ?? null}, ${input.targetDeviceId ?? null}, ${input.modelId}, 'queued'
      )
      returning *
    `;

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
    select *
    from generation_attempts
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

  return { ...rows[0], attempts, outputs };
}

export async function listRecentGenerationJobs(projectId?: string | null) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return projectId
    ? sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id}
          and j.project_id = ${projectId}
        order by j.created_at desc
        limit 50
      `
    : sql`
        select j.*, s.title as scene_title
        from generation_jobs j
        left join scenes s on s.id = j.scene_id
        where j.workspace_id = ${workspace.id}
        order by j.created_at desc
        limit 50
      `;
}
