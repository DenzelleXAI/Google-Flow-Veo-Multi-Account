import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

type MediaReplica = {
  id: string;
  device_id: string;
  device_name: string;
  device_status: string;
  relative_path: string | null;
  status: string;
  expected_hash: string | null;
  verified_hash: string | null;
  file_size_bytes: number | null;
  verified_at: string | Date | null;
  last_seen_at: string | Date | null;
};

type MediaOutput = {
  generation_output_id: string;
  asset_id: string;
  filename: string;
  mime_type: string | null;
  r2_key: string | null;
  relay_delete_after: string | Date | null;
  relay_deleted_at: string | Date | null;
  provider_reference_last_used_at: string | Date | null;
  sha256: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  created_at: string | Date;
  replicas: MediaReplica[];
};

export async function getGenerationMediaState(jobId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const jobs = await sql`
    select id, target_device_id, status
    from generation_jobs
    where id = ${jobId} and workspace_id = ${workspace.id}
    limit 1
  `;
  const job = jobs[0];
  if (!job) return null;

  const outputRows = await sql`
    select
      go.id as generation_output_id,
      a.id as asset_id,
      a.filename,
      a.mime_type,
      a.r2_key,
      a.relay_delete_after,
      a.relay_deleted_at,
      a.provider_reference_last_used_at,
      a.sha256,
      a.file_size_bytes,
      a.duration_seconds,
      go.created_at
    from generation_outputs go
    join assets a on a.id = go.asset_id
    where go.generation_job_id = ${jobId}
    order by go.created_at asc
  `;

  const assetIds = outputRows.map((row) => String(row.asset_id));
  let replicaRows: Array<Record<string, unknown>> = [];
  if (assetIds.length) {
    const rows = await sql`
      select
        al.id,
        al.asset_id,
        al.device_id,
        d.name as device_name,
        d.status as device_status,
        al.relative_path,
        al.status,
        al.expected_hash,
        al.verified_hash,
        al.file_size_bytes,
        al.verified_at,
        al.last_seen_at
      from asset_locations al
      join devices d on d.id = al.device_id
      where al.asset_id = any(${assetIds})
        and d.workspace_id = ${workspace.id}
      order by d.name asc
    `;
    replicaRows = Array.from(rows) as unknown as Array<Record<string, unknown>>;
  }

  const replicasByAsset = new Map<string, MediaReplica[]>();
  for (const row of replicaRows) {
    const assetId = String(row.asset_id);
    const list = replicasByAsset.get(assetId) ?? [];
    list.push({
      id: String(row.id),
      device_id: String(row.device_id),
      device_name: String(row.device_name),
      device_status: String(row.device_status),
      relative_path: row.relative_path === null ? null : String(row.relative_path),
      status: String(row.status),
      expected_hash: row.expected_hash === null ? null : String(row.expected_hash),
      verified_hash: row.verified_hash === null ? null : String(row.verified_hash),
      file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
      verified_at: (row.verified_at as string | Date | null) ?? null,
      last_seen_at: (row.last_seen_at as string | Date | null) ?? null,
    });
    replicasByAsset.set(assetId, list);
  }

  const outputs: MediaOutput[] = outputRows.map((row) => {
    const assetId = String(row.asset_id);
    return {
      generation_output_id: String(row.generation_output_id),
      asset_id: assetId,
      filename: String(row.filename),
      mime_type: row.mime_type === null ? null : String(row.mime_type),
      r2_key: row.r2_key === null ? null : String(row.r2_key),
      relay_delete_after: (row.relay_delete_after as string | Date | null) ?? null,
      relay_deleted_at: (row.relay_deleted_at as string | Date | null) ?? null,
      provider_reference_last_used_at: (row.provider_reference_last_used_at as string | Date | null) ?? null,
      sha256: row.sha256 === null ? null : String(row.sha256),
      file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
      duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      created_at: row.created_at as string | Date,
      replicas: replicasByAsset.get(assetId) ?? [],
    };
  });

  return {
    jobId: String(job.id),
    jobStatus: String(job.status),
    targetDeviceId: job.target_device_id ? String(job.target_device_id) : null,
    outputs,
  };
}
