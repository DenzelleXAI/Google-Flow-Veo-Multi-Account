import { requireDb } from "./db";

export type AgentMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string | Date;
};

export async function ensureAgentThread(projectId: string) {
  const sql = requireDb();
  const existing = await sql`
    select id from agent_threads
    where project_id = ${projectId}
    limit 1
  `;
  if (existing[0]) return String(existing[0].id);

  const rows = await sql`
    insert into agent_threads (project_id)
    select ${projectId}
    where exists (select 1 from projects where id = ${projectId})
    on conflict (project_id) do update set updated_at = now()
    returning id
  `;
  if (!rows[0]) throw new Error("Project not found.");
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
    limit ${limit}
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
