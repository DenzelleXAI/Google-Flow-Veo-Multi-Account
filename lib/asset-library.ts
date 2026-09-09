import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type AssetLibraryItem = {
  id: string;
  project_id: string;
  project_name: string;
  type: string;
  filename: string;
  mime_type: string | null;
  relative_path: string | null;
  r2_key: string | null;
  relay_delete_after: string | Date | null;
  relay_deleted_at: string | Date | null;
  provider_reference_last_used_at: string | Date | null;
  sha256: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  replica_count: number;
  verified_replica_count: number;
  created_at: string | Date;
};

export async function listWorkspaceAssets(projectId?: string | null): Promise<AssetLibraryItem[]> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const rows = projectId
    ? await sql`
        select
          a.id,
          a.project_id,
          p.name as project_name,
          a.type,
          a.filename,
          a.mime_type,
          a.relative_path,
          a.r2_key,
          a.relay_delete_after,
          a.relay_deleted_at,
          a.veo_reference_refreshed_at as provider_reference_last_used_at,
          a.sha256,
          a.file_size_bytes,
          a.width,
          a.height,
          a.duration_seconds,
          count(al.id)::int as replica_count,
          count(al.id) filter (
            where al.status = 'verified'
              and al.verified_hash is not null
              and al.verified_hash = a.sha256
          )::int as verified_replica_count,
          a.created_at
        from assets a
        join projects p on p.id = a.project_id
        left join asset_locations al on al.asset_id = a.id
        where p.workspace_id = ${workspace.id}
          and a.project_id = ${projectId}
        group by a.id, p.name
        order by a.created_at desc
        limit 500
      `
    : await sql`
        select
          a.id,
          a.project_id,
          p.name as project_name,
          a.type,
          a.filename,
          a.mime_type,
          a.relative_path,
          a.r2_key,
          a.relay_delete_after,
          a.relay_deleted_at,
          a.veo_reference_refreshed_at as provider_reference_last_used_at,
          a.sha256,
          a.file_size_bytes,
          a.width,
          a.height,
          a.duration_seconds,
          count(al.id)::int as replica_count,
          count(al.id) filter (
            where al.status = 'verified'
              and al.verified_hash is not null
              and al.verified_hash = a.sha256
          )::int as verified_replica_count,
          a.created_at
        from assets a
        join projects p on p.id = a.project_id
        left join asset_locations al on al.asset_id = a.id
        where p.workspace_id = ${workspace.id}
        group by a.id, p.name
        order by a.created_at desc
        limit 500
      `;

  return Array.from(rows).map((row) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    project_name: String(row.project_name),
    type: String(row.type),
    filename: String(row.filename),
    mime_type: row.mime_type === null ? null : String(row.mime_type),
    relative_path: row.relative_path === null ? null : String(row.relative_path),
    r2_key: row.r2_key === null ? null : String(row.r2_key),
    relay_delete_after: (row.relay_delete_after as string | Date | null) ?? null,
    relay_deleted_at: (row.relay_deleted_at as string | Date | null) ?? null,
    provider_reference_last_used_at: (row.provider_reference_last_used_at as string | Date | null) ?? null,
    sha256: row.sha256 === null ? null : String(row.sha256),
    file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    replica_count: Number(row.replica_count ?? 0),
    verified_replica_count: Number(row.verified_replica_count ?? 0),
    created_at: row.created_at as string | Date,
  }));
}
