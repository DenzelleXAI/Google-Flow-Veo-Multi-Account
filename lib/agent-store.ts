import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type AgentMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string | Date;
};

async function requireWorkspaceProject(projectId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select id
    from projects
    where id = ${projectId} and workspace_id = ${workspace.id}
    limit 1
  `;
  if (!rows[0]) throw new Error("Project not found in current workspace.");
  return workspace;
}

export async function ensureAgentThread(projectId: string) {
  const sql = requireDb();
  const workspace = await requireWorkspaceProject(projectId);
  const existing = await sql`
    select t.id
    from agent_threads t
    join projects p on p.id = t.project_id
    where t.project_id = ${projectId}
      and p.workspace_id = ${workspace.id}
    limit 1
  `;
  if (existing[0]) return String(existing[0].id);

  const rows = await sql`
    insert into agent_threads (project_id)
    select p.id
    from projects p
    where p.id = ${projectId} and p.workspace_id = ${workspace.id}
    on conflict (project_id) do update set updated_at = now()
    returning id
  `;
  if (!rows[0]) throw new Error("Project not found in current workspace.");
  return String(rows[0].id);
}

export async function listAgentMessages(projectId: string, limit = 40) {
  const sql = requireDb();
  const threadId = await ensureAgentThread(projectId);
  const rows = await sql`
    select id, role, content, created_at
    from agent_messages
    where thread_id = ${threadId}
      and role in ('user', 'assistant')
    order by created_at desc
    limit ${Math.max(1, Math.min(limit, 100))}
  `;
  return Array.from(rows).reverse() as unknown as AgentMessageRecord[];
}

export async function saveAgentMessage(projectId: string, role: "user" | "assistant", content: string, metadata?: unknown) {
  const sql = requireDb();
  const threadId = await ensureAgentThread(projectId);
  const rows = await sql`
    insert into agent_messages (thread_id, role, content, metadata)
    values (${threadId}, ${role}, ${content}, ${metadata ? JSON.stringify(metadata) : null}::jsonb)
    returning id, role, content, created_at
  `;
  await sql`update agent_threads set updated_at = now() where id = ${threadId}`;
  return rows[0] as unknown as AgentMessageRecord;
}
