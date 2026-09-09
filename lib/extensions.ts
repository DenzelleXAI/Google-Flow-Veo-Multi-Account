import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";
import { GenerationSafetyError } from "./generations";

export async function assertExtensionSourceFresh(parentJobId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  // This UPDATE intentionally does more than read freshness. If local delivery
  // has already scheduled relay cleanup, it pins the source for another two
  // days before the extension job is created. That serializes against the
  // cleanup worker's row lock and removes the queue-vs-delete race.
  const rows = await sql`
    update assets a
    set relay_delete_after = case
      when a.relay_delete_after is null then null
      else greatest(a.relay_delete_after, now() + interval '2 days')
    end
    from generation_jobs j, generation_outputs go
    where j.id = ${parentJobId}
      and j.workspace_id = ${workspace.id}
      and go.generation_job_id = j.id
      and go.asset_id = a.id
      and a.type = 'GENERATED_VIDEO'
      and a.r2_key is not null
      and a.relay_deleted_at is null
      and coalesce(a.veo_reference_refreshed_at, a.created_at) >= now() - interval '2 days'
      and go.created_at = (
        select max(go2.created_at)
        from generation_outputs go2
        where go2.generation_job_id = j.id
      )
    returning
      a.id as asset_id,
      coalesce(a.veo_reference_refreshed_at, a.created_at) as last_provider_reference_at,
      a.relay_delete_after
  `;

  const source = rows[0];
  if (!source) {
    const diagnostic = await sql`
      select
        a.id as asset_id,
        a.r2_key,
        a.relay_deleted_at,
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
    const existing = diagnostic[0];
    if (!existing) {
      throw new GenerationSafetyError("INVALID_EXTENSION_SOURCE", "Parent generation has no Veo output to extend.");
    }
    if (!existing.provider_reference_fresh) {
      throw new GenerationSafetyError(
        "INVALID_EXTENSION_SOURCE",
        "This Veo output is outside Google's two-day extension reference window. Generate or extend a fresh 720p source first.",
      );
    }
    throw new GenerationSafetyError(
      "INVALID_EXTENSION_SOURCE",
      "The Veo source is no longer available in the R2 relay for extension.",
    );
  }

  return {
    assetId: String(source.asset_id),
    lastProviderReferenceAt: source.last_provider_reference_at,
    relayDeleteAfter: source.relay_delete_after,
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
