import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export async function assertGenerationJobInCurrentWorkspace(jobId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select id, project_id
    from generation_jobs
    where id = ${jobId}
      and workspace_id = ${workspace.id}
    limit 1
  `;
  if (!rows[0]) return null;
  return {
    id: String(rows[0].id),
    projectId: String(rows[0].project_id),
    workspaceId: String(workspace.id),
  };
}
