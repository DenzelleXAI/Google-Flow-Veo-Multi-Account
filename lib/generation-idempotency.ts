import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";
import type { GenerationJobRecord } from "./generations";

export async function findGenerationJobByRequestId(generationRequestId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select *
    from generation_jobs
    where workspace_id = ${workspace.id}
      and generation_request_id = ${generationRequestId}
    limit 1
  `;
  return (rows[0] as unknown as GenerationJobRecord | undefined) ?? null;
}
