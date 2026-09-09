import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

function rowsToPlain(rows: Iterable<Record<string, unknown>>) {
  return Array.from(rows, (row) => ({ ...row }));
}

export async function createProjectBackup(projectId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const projectRows = await sql`
    select id, name, description, created_at, updated_at
    from projects
    where id = ${projectId} and workspace_id = ${workspace.id}
    limit 1
  `;
  if (!projectRows[0]) return null;

  const [scenes, promptVersions, assets, replicas, jobs, jobAssets, attempts, outputs, agentThreads, researchSessions] = await Promise.all([
    sql`
      select id, title, description, aspect_ratio, duration_seconds, resolution, created_at, updated_at
      from scenes
      where project_id = ${projectId}
      order by created_at asc
    `,
    sql`
      select spv.id, spv.scene_id, spv.version, spv.content, spv.created_by,
             spv.parent_version_id, spv.created_at
      from scene_prompt_versions spv
      join scenes s on s.id = spv.scene_id
      where s.project_id = ${projectId}
      order by spv.scene_id, spv.version
    `,
    sql`
      select id, type, filename, mime_type, relative_path, r2_key, sha256,
             file_size_bytes, width, height, duration_seconds,
             relay_delete_after, relay_deleted_at, veo_reference_refreshed_at,
             provider_reference_last_used_at, created_at
      from assets
      where project_id = ${projectId}
      order by created_at asc
    `,
    sql`
      select al.id, al.asset_id, d.name as device_name, d.platform as device_platform,
             al.relative_path, al.status, al.expected_hash, al.verified_hash,
             al.file_size_bytes, al.verified_at, al.last_seen_at
      from asset_locations al
      join assets a on a.id = al.asset_id
      join devices d on d.id = al.device_id
      where a.project_id = ${projectId}
      order by al.asset_id, d.name
    `,
    sql`
      select j.id, j.generation_request_id, j.scene_id,
             ap.name as requested_api_profile_name,
             d.name as target_device_name,
             j.model_id, j.prompt_snapshot, j.aspect_ratio_snapshot,
             j.duration_seconds_snapshot, j.resolution_snapshot,
             j.estimated_cost_usd, j.pricing_version, j.status,
             j.parent_generation_job_id, j.generation_mode, j.extension_depth,
             j.expected_output_duration_seconds, j.created_at, j.updated_at
      from generation_jobs j
      left join api_profiles ap on ap.id = j.requested_api_profile_id
      left join devices d on d.id = j.target_device_id
      where j.project_id = ${projectId}
      order by j.created_at asc
    `,
    sql`
      select gja.id, gja.generation_job_id, gja.asset_id, gja.role, gja.sort_order, gja.created_at
      from generation_job_assets gja
      join generation_jobs j on j.id = gja.generation_job_id
      where j.project_id = ${projectId}
      order by gja.generation_job_id, gja.role, gja.sort_order
    `,
    sql`
      select ga.id, ga.generation_job_id, ap.name as api_profile_name,
             ga.provider, ga.model_id, ga.provider_operation_id, ga.status,
             ga.started_at, ga.completed_at, ga.error_code, ga.error_message
      from generation_attempts ga
      join generation_jobs j on j.id = ga.generation_job_id
      left join api_profiles ap on ap.id = ga.api_profile_id
      where j.project_id = ${projectId}
      order by ga.started_at asc
    `,
    sql`
      select go.id, go.generation_job_id, go.asset_id, go.created_at
      from generation_outputs go
      join generation_jobs j on j.id = go.generation_job_id
      where j.project_id = ${projectId}
      order by go.created_at asc
    `,
    sql`
      select id, created_at, updated_at
      from agent_threads
      where project_id = ${projectId}
      order by created_at asc
    `,
    sql`
      select id, api_profile_id, query, mode, summary, search_queries, created_at
      from research_sessions
      where project_id = ${projectId}
      order by created_at asc
    `,
  ]);

  const threadIds = agentThreads.map((row) => String(row.id));
  const researchIds = researchSessions.map((row) => String(row.id));

  const agentMessages = threadIds.length
    ? await sql`
        select id, thread_id, role, content, metadata, created_at
        from agent_messages
        where thread_id = any(${threadIds}::uuid[])
        order by created_at asc
      `
    : [];

  const researchSources = researchIds.length
    ? await sql`
        select id, research_session_id, url, title, citation_start, citation_end,
               metadata, retrieved_at
        from research_sources
        where research_session_id = any(${researchIds}::uuid[])
        order by retrieved_at asc
      `
    : [];

  return {
    format: "persistent-ai-video-studio-project-backup",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    security: {
      credentialsIncluded: false,
      note: "Provider credentials, encrypted credentials, auth/session secrets, database credentials, R2 credentials, Inngest keys, and companion tokens are intentionally excluded.",
    },
    project: { ...projectRows[0] },
    scenes: rowsToPlain(scenes),
    promptVersions: rowsToPlain(promptVersions),
    assets: rowsToPlain(assets),
    assetReplicas: rowsToPlain(replicas),
    generationJobs: rowsToPlain(jobs),
    generationJobAssets: rowsToPlain(jobAssets),
    generationAttempts: rowsToPlain(attempts),
    generationOutputs: rowsToPlain(outputs),
    agentThreads: rowsToPlain(agentThreads),
    agentMessages: rowsToPlain(agentMessages as Iterable<Record<string, unknown>>),
    researchSessions: rowsToPlain(researchSessions),
    researchSources: rowsToPlain(researchSources as Iterable<Record<string, unknown>>),
  };
}
