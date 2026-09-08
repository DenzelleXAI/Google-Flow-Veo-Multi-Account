import { requireDb } from "./db";
import { createRelayDownloadUrl } from "./r2";
import { ensurePersonalWorkspace } from "./workspace";

export type PendingLocalAsset = {
  assetId: string;
  generationJobId: string;
  filename: string;
  sha256: string;
  fileSizeBytes: number | null;
  r2Key: string;
  relativePath: string;
  downloadUrl: string;
};

export async function listPendingLocalAssets(deviceId: string): Promise<PendingLocalAsset[]> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const devices = await sql`
    select id from devices
    where id = ${deviceId} and workspace_id = ${workspace.id}
    limit 1
  `;
  if (!devices[0]) throw new Error("Device not found in this workspace.");

  const rows = await sql`
    select
      a.id as asset_id,
      go.generation_job_id,
      a.filename,
      a.sha256,
      a.file_size_bytes,
      a.r2_key,
      p.name as project_name
    from generation_outputs go
    join generation_jobs j on j.id = go.generation_job_id
    join assets a on a.id = go.asset_id
    join projects p on p.id = j.project_id
    left join asset_locations al
      on al.asset_id = a.id
      and al.device_id = ${deviceId}
      and al.status = 'verified'
      and al.verified_hash = a.sha256
    where j.workspace_id = ${workspace.id}
      and j.target_device_id = ${deviceId}
      and j.status = 'cloud_ready'
      and a.r2_key is not null
      and a.sha256 is not null
      and al.id is null
    order by go.created_at asc
    limit 25
  `;

  const pending: PendingLocalAsset[] = [];
  for (const row of rows) {
    const projectFolder = String(row.project_name ?? "Project").replace(/[<>:"/\\|?*]+/g, "_").trim() || "Project";
    const filename = String(row.filename);
    const r2Key = String(row.r2_key);
    pending.push({
      assetId: String(row.asset_id),
      generationJobId: String(row.generation_job_id),
      filename,
      sha256: String(row.sha256),
      fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
      r2Key,
      relativePath: `Projects/${projectFolder}/generations/${filename}`,
      downloadUrl: await createRelayDownloadUrl(r2Key, 900),
    });
  }

  return pending;
}
