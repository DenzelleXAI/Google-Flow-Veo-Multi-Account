import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export async function listDevices() {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql`
    select id, name, platform, media_root, free_disk_bytes, last_seen_at, status, created_at
    from devices
    where workspace_id = ${workspace.id}
    order by last_seen_at desc nulls last, created_at asc
  `;
}

export async function registerOrHeartbeatDevice(input: {
  id?: string | null;
  name: string;
  platform?: string | null;
  mediaRoot?: string | null;
  freeDiskBytes?: number | null;
}) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  if (input.id) {
    const rows = await sql`
      update devices
      set name = ${input.name},
          platform = ${input.platform ?? null},
          media_root = ${input.mediaRoot ?? null},
          free_disk_bytes = ${input.freeDiskBytes ?? null},
          last_seen_at = now(),
          status = 'online'
      where id = ${input.id}
        and workspace_id = ${workspace.id}
      returning *
    `;

    if (rows[0]) return rows[0];
  }

  const rows = await sql`
    insert into devices (
      workspace_id, name, platform, media_root, free_disk_bytes, last_seen_at, status
    ) values (
      ${workspace.id}, ${input.name}, ${input.platform ?? null}, ${input.mediaRoot ?? null},
      ${input.freeDiskBytes ?? null}, now(), 'online'
    )
    returning *
  `;

  const device = rows[0];

  await sql`
    insert into workspace_settings (workspace_id, default_target_device_id)
    values (${workspace.id}, ${device.id})
    on conflict (workspace_id) do update
      set default_target_device_id = coalesce(workspace_settings.default_target_device_id, excluded.default_target_device_id),
          updated_at = now()
  `;

  return device;
}

export async function createAsset(input: {
  projectId: string;
  type: string;
  filename: string;
  mimeType?: string | null;
  relativePath?: string | null;
  r2Key?: string | null;
  sha256?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}) {
  const sql = requireDb();

  const rows = await sql`
    insert into assets (
      project_id, type, filename, mime_type, relative_path, r2_key, sha256,
      file_size_bytes, width, height, duration_seconds
    ) values (
      ${input.projectId}, ${input.type}, ${input.filename}, ${input.mimeType ?? null},
      ${input.relativePath ?? null}, ${input.r2Key ?? null}, ${input.sha256 ?? null},
      ${input.fileSizeBytes ?? null}, ${input.width ?? null}, ${input.height ?? null},
      ${input.durationSeconds ?? null}
    )
    returning *
  `;

  return rows[0];
}

export async function listProjectAssets(projectId: string) {
  const sql = requireDb();
  return sql`
    select id, project_id, type, filename, mime_type, relative_path, r2_key,
      relay_delete_after, relay_deleted_at,
      sha256, file_size_bytes, width, height, duration_seconds, created_at
    from assets
    where project_id = ${projectId}
    order by created_at desc
  `;
}

export async function getAsset(assetId: string) {
  const sql = requireDb();
  const rows = await sql`
    select * from assets where id = ${assetId} limit 1
  `;
  return rows[0] ?? null;
}

export async function upsertAssetLocation(input: {
  assetId: string;
  deviceId: string;
  relativePath?: string | null;
  status: string;
  expectedHash?: string | null;
  verifiedHash?: string | null;
  fileSizeBytes?: number | null;
}) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  return sql.begin(async (tx) => {
    const devices = await tx`
      select id from devices
      where id = ${input.deviceId} and workspace_id = ${workspace.id}
      limit 1
    `;
    if (!devices[0]) throw new Error("Device does not belong to this workspace.");

    const assets = await tx`
      select a.id, a.sha256, a.type, a.r2_key, p.workspace_id
      from assets a
      join projects p on p.id = a.project_id
      where a.id = ${input.assetId} and p.workspace_id = ${workspace.id}
      limit 1
    `;
    const asset = assets[0];
    if (!asset) throw new Error("Asset does not belong to this workspace.");

    if (input.status === "verified") {
      if (!asset.sha256) throw new Error("Asset has no expected SHA-256 hash.");
      if (!input.verifiedHash || input.verifiedHash !== asset.sha256) {
        throw new Error("Verified hash does not match the asset SHA-256.");
      }
    }

    const rows = await tx`
      insert into asset_locations (
        asset_id, device_id, relative_path, status, expected_hash, verified_hash,
        file_size_bytes, verified_at, last_seen_at
      ) values (
        ${input.assetId}, ${input.deviceId}, ${input.relativePath ?? null}, ${input.status},
        ${asset.sha256 ?? input.expectedHash ?? null}, ${input.verifiedHash ?? null}, ${input.fileSizeBytes ?? null},
        ${input.status === 'verified' ? new Date() : null}, now()
      )
      on conflict (asset_id, device_id) do update
        set relative_path = excluded.relative_path,
            status = excluded.status,
            expected_hash = excluded.expected_hash,
            verified_hash = excluded.verified_hash,
            file_size_bytes = excluded.file_size_bytes,
            verified_at = case when excluded.status = 'verified' then now() else asset_locations.verified_at end,
            last_seen_at = now()
      returning *
    `;

    if (input.status === "verified") {
      const confirmedJobs = await tx`
        update generation_jobs j
        set status = 'local_confirmed', updated_at = now()
        from generation_outputs go
        where go.generation_job_id = j.id
          and go.asset_id = ${input.assetId}
          and j.target_device_id = ${input.deviceId}
          and j.workspace_id = ${workspace.id}
          and j.status = 'cloud_ready'
        returning j.id
      `;

      if (confirmedJobs.length > 0 && asset.type === "GENERATED_VIDEO" && asset.r2_key) {
        await tx`
          update assets
          set relay_delete_after = coalesce(relay_delete_after, now() + interval '24 hours')
          where id = ${input.assetId}
            and relay_deleted_at is null
        `;
      }
    }

    return rows[0];
  });
}
