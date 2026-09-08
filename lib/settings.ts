import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type WorkspaceSafetySettings = {
  workspace_id: string;
  default_target_device_id: string | null;
  daily_generation_limit: number;
  monthly_generation_limit: number;
  daily_spend_limit_usd: number;
  monthly_spend_limit_usd: number;
  per_request_spend_limit_usd: number;
  min_free_disk_bytes: number;
  device_stale_after_seconds: number;
};

export async function getWorkspaceSafetySettings(): Promise<WorkspaceSafetySettings> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  await sql`
    insert into workspace_settings (workspace_id)
    values (${workspace.id})
    on conflict (workspace_id) do nothing
  `;

  const rows = await sql`
    select workspace_id, default_target_device_id, daily_generation_limit,
      monthly_generation_limit, daily_spend_limit_usd, monthly_spend_limit_usd,
      per_request_spend_limit_usd, min_free_disk_bytes, device_stale_after_seconds
    from workspace_settings
    where workspace_id = ${workspace.id}
    limit 1
  `;

  return rows[0] as unknown as WorkspaceSafetySettings;
}

export async function updateWorkspaceSafetySettings(input: {
  defaultTargetDeviceId?: string | null;
  dailyGenerationLimit?: number;
  monthlyGenerationLimit?: number;
  dailySpendLimitUsd?: number;
  monthlySpendLimitUsd?: number;
  perRequestSpendLimitUsd?: number;
  minFreeDiskBytes?: number;
  deviceStaleAfterSeconds?: number;
}) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  await sql`
    insert into workspace_settings (workspace_id)
    values (${workspace.id})
    on conflict (workspace_id) do nothing
  `;

  if (input.defaultTargetDeviceId !== undefined && input.defaultTargetDeviceId !== null) {
    const devices = await sql`
      select id from devices
      where id = ${input.defaultTargetDeviceId}
        and workspace_id = ${workspace.id}
      limit 1
    `;
    if (!devices[0]) throw new Error("Selected target device does not exist in this workspace.");
  }

  const rows = await sql`
    update workspace_settings
    set default_target_device_id = case
          when ${input.defaultTargetDeviceId !== undefined} then ${input.defaultTargetDeviceId ?? null}
          else default_target_device_id
        end,
        daily_generation_limit = coalesce(${input.dailyGenerationLimit ?? null}, daily_generation_limit),
        monthly_generation_limit = coalesce(${input.monthlyGenerationLimit ?? null}, monthly_generation_limit),
        daily_spend_limit_usd = coalesce(${input.dailySpendLimitUsd ?? null}, daily_spend_limit_usd),
        monthly_spend_limit_usd = coalesce(${input.monthlySpendLimitUsd ?? null}, monthly_spend_limit_usd),
        per_request_spend_limit_usd = coalesce(${input.perRequestSpendLimitUsd ?? null}, per_request_spend_limit_usd),
        min_free_disk_bytes = coalesce(${input.minFreeDiskBytes ?? null}, min_free_disk_bytes),
        device_stale_after_seconds = coalesce(${input.deviceStaleAfterSeconds ?? null}, device_stale_after_seconds),
        updated_at = now()
    where workspace_id = ${workspace.id}
    returning workspace_id, default_target_device_id, daily_generation_limit,
      monthly_generation_limit, daily_spend_limit_usd, monthly_spend_limit_usd,
      per_request_spend_limit_usd, min_free_disk_bytes, device_stale_after_seconds
  `;

  return rows[0] as unknown as WorkspaceSafetySettings;
}
