import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";
import { GenerationSafetyError } from "./generations";

export async function assertExtensionSourceFresh(parentJobId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select
      a.id as asset_id,
      coalesce(a.veo_reference_refreshed_at, a.created_at) as last_provider_reference_at,
      coalesce(a.veo_reference_refreshed_at, a.created_at) >= now() - interval '2 days' as provider_reference_fresh
    from generation_jobs j
    join generation_outputs go on go.generation_job_id = j.id
    join assets a on a.id = go.asset_id
    where j.id = ${parentJobId}
      and j.workspace_id = ${workspace.id}
      and a.type = 'GENERATED_VIDEO'
    order by go.created_at desc
    limit 1
  `;

  const source = rows[0];
  if (!source) {
    throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Parent generation has no Veo output to extend.");
  }
  if (!source.provider_reference_fresh) {
    throw new GenerationSafetyError(
      "INVALID_EXTENSION_SOURCE",
      "This Veo output is outside Google's two-day extension reference window. Generate or extend a fresh 720p source first.",
    );
  }

  return {
    assetId: String(source.asset_id),
    lastProviderReferenceAt: source.last_provider_reference_at,
  };
}

export async function markExtensionSourceReferenced(extensionJobId: string) {
  const sql = requireDb();
  const rows = await sql`
    update assets a
    set veo_reference_refreshed_at = now(),
        relay_delete_after = case
          when a.relay_delete_after is null then null
          else greatest(a.relay_delete_after, now() + interval '2 days')
        end
    from generation_job_assets gja, generation_jobs j
    where gja.generation_job_id = ${extensionJobId}
      and gja.generation_job_id = j.id
      and gja.asset_id = a.id
      and gja.role = 'extension_source'
      and j.generation_mode = 'extend'
    returning a.id, a.veo_reference_refreshed_at, a.relay_delete_after
  `;
  return rows[0] ?? null;
}
