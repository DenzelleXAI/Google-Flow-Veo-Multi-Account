import { requireDb } from "./db";

export async function ensurePersonalWorkspace() {
  const sql = requireDb();

  const existing = await sql`
    select id, name
    from workspaces
    order by created_at asc
    limit 1
  `;

  if (existing[0]) return existing[0];

  const created = await sql`
    insert into workspaces (name)
    values ('Personal Workspace')
    returning id, name
  `;

  return created[0];
}

export async function listProjects() {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql`
    select p.id, p.name, p.description, p.created_at, p.updated_at,
      (select count(*)::int from scenes s where s.project_id = p.id) as scene_count
    from projects p
    where p.workspace_id = ${workspace.id}
    order by p.updated_at desc
  `;
}

export async function createProject(name: string, description?: string | null) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const rows = await sql`
    insert into projects (workspace_id, name, description)
    values (${workspace.id}, ${name}, ${description ?? null})
    returning id, workspace_id, name, description, created_at, updated_at
  `;

  return rows[0];
}

export async function listScenes(projectId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql`
    select s.id, s.project_id, s.title, s.description, s.aspect_ratio,
      s.duration_seconds, s.resolution, s.created_at, s.updated_at,
      pv.id as prompt_version_id, pv.version as prompt_version, pv.content as prompt
    from scenes s
    join projects p on p.id = s.project_id
    left join lateral (
      select id, version, content
      from scene_prompt_versions
      where scene_id = s.id
      order by version desc
      limit 1
    ) pv on true
    where s.project_id = ${projectId}
      and p.workspace_id = ${workspace.id}
    order by s.created_at asc
  `;
}

export async function createScene(projectId: string, title: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const rows = await sql`
    insert into scenes (project_id, title)
    select p.id, ${title}
    from projects p
    where p.id = ${projectId}
      and p.workspace_id = ${workspace.id}
    returning *
  `;

  if (!rows[0]) throw new Error("Project not found in current workspace.");
  return rows[0];
}

export async function savePromptVersion(sceneId: string, content: string, createdBy = "user") {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql.begin(async (tx) => {
    const scenes = await tx`
      select s.id
      from scenes s
      join projects p on p.id = s.project_id
      where s.id = ${sceneId}
        and p.workspace_id = ${workspace.id}
      limit 1
      for update of s
    `;
    if (!scenes[0]) throw new Error("Scene not found in current workspace.");

    const versions = await tx`
      select coalesce(max(version), 0)::int as current_version
      from scene_prompt_versions
      where scene_id = ${sceneId}
    `;

    const nextVersion = versions[0].current_version + 1;

    const rows = await tx`
      insert into scene_prompt_versions (scene_id, version, content, created_by)
      values (${sceneId}, ${nextVersion}, ${content}, ${createdBy})
      returning id, scene_id, version, content, created_by, created_at
    `;

    await tx`
      update scenes
      set updated_at = now()
      where id = ${sceneId}
    `;

    return rows[0];
  });
}
