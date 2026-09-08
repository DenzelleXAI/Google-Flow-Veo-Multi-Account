import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";
import { resolveGoogleProfile } from "./provider-profiles";
import { validateVeoSettings } from "./model-registry";

export type GenerationPreflightResult = {
  ok: boolean;
  checks: Array<{
    code: string;
    ok: boolean;
    message: string;
  }>;
  effectiveTargetDeviceId: string | null;
  effectiveApiProfileId: string | null;
  usage: {
    daily: number;
    dailyLimit: number;
    monthly: number;
    monthlyLimit: number;
  };
};

export async function runGenerationPreflight(input: {
  projectId: string;
  requestedApiProfileId?: string | null;
  targetDeviceId?: string | null;
  modelId: string;
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}) : Promise<GenerationPreflightResult> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const checks: GenerationPreflightResult["checks"] = [];

  const projectRows = await sql`
    select id from projects
    where id = ${input.projectId} and workspace_id = ${workspace.id}
    limit 1
  `;
  checks.push({
    code: "PROJECT",
    ok: Boolean(projectRows[0]),
    message: projectRows[0] ? "Project belongs to this workspace." : "Project does not belong to this workspace.",
  });

  const capabilityError = validateVeoSettings({
    modelId: input.modelId,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
  });
  checks.push({
    code: "MODEL_CAPABILITY",
    ok: !capabilityError,
    message: capabilityError ?? "Model settings are supported.",
  });

  await sql`
    insert into workspace_settings (workspace_id)
    values (${workspace.id})
    on conflict (workspace_id) do nothing
  `;

  const settingsRows = await sql`
    select default_target_device_id, daily_generation_limit, monthly_generation_limit,
           min_free_disk_bytes, device_stale_after_seconds
    from workspace_settings
    where workspace_id = ${workspace.id}
    limit 1
  `;
  const settings = settingsRows[0];

  const usageRows = await sql`
    select
      count(*) filter (
        where created_at >= date_trunc('day', now())
          and status not in ('cancelled', 'failed_final')
      )::int as daily_count,
      count(*) filter (
        where created_at >= date_trunc('month', now())
          and status not in ('cancelled', 'failed_final')
      )::int as monthly_count
    from generation_jobs
    where workspace_id = ${workspace.id}
  `;
  const usageRow = usageRows[0];
  const usage = {
    daily: Number(usageRow.daily_count),
    dailyLimit: Number(settings.daily_generation_limit),
    monthly: Number(usageRow.monthly_count),
    monthlyLimit: Number(settings.monthly_generation_limit),
  };

  checks.push({
    code: "DAILY_LIMIT",
    ok: usage.daily < usage.dailyLimit,
    message: `${usage.daily}/${usage.dailyLimit} generation jobs used today.`,
  });
  checks.push({
    code: "MONTHLY_LIMIT",
    ok: usage.monthly < usage.monthlyLimit,
    message: `${usage.monthly}/${usage.monthlyLimit} generation jobs used this month.`,
  });

  const effectiveTargetDeviceId = input.targetDeviceId ?? settings.default_target_device_id ?? null;
  if (effectiveTargetDeviceId) {
    const deviceRows = await sql`
      select id, name, free_disk_bytes, last_seen_at,
        extract(epoch from (now() - last_seen_at))::int as seconds_since_seen
      from devices
      where id = ${effectiveTargetDeviceId} and workspace_id = ${workspace.id}
      limit 1
    `;
    const device = deviceRows[0];
    if (!device) {
      checks.push({ code: "TARGET_DEVICE", ok: false, message: "Selected target device does not exist." });
    } else {
      const fresh = Boolean(device.last_seen_at) && Number(device.seconds_since_seen) <= Number(settings.device_stale_after_seconds);
      checks.push({
        code: "TARGET_DEVICE",
        ok: true,
        message: fresh ? `${device.name} is online/recently seen.` : `${device.name} is offline or stale; R2 relay will hold the output.`,
      });

      if (fresh && device.free_disk_bytes !== null) {
        const free = Number(device.free_disk_bytes);
        const reserve = Number(settings.min_free_disk_bytes);
        checks.push({
          code: "DISK_SPACE",
          ok: free >= reserve,
          message: free >= reserve
            ? `${(free / 1024 ** 3).toFixed(1)} GB free on ${device.name}.`
            : `${device.name} has ${(free / 1024 ** 3).toFixed(1)} GB free; ${(reserve / 1024 ** 3).toFixed(0)} GB reserve is required.`,
        });
      } else {
        checks.push({
          code: "DISK_SPACE",
          ok: true,
          message: "Local disk cannot be verified right now; cloud relay remains available.",
        });
      }
    }
  } else {
    checks.push({
      code: "TARGET_DEVICE",
      ok: true,
      message: "No target device selected; output will remain in the R2 relay until a device is chosen.",
    });
  }

  let effectiveApiProfileId: string | null = null;
  try {
    const resolved = await resolveGoogleProfile(input.requestedApiProfileId ?? null);
    effectiveApiProfileId = resolved.profile.id;
    checks.push({
      code: "API_PROFILE",
      ok: true,
      message: `Google profile is available: ${resolved.profile.name}.`,
    });
  } catch (error) {
    checks.push({
      code: "API_PROFILE",
      ok: false,
      message: error instanceof Error ? error.message : "No usable Google profile is available.",
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    effectiveTargetDeviceId,
    effectiveApiProfileId,
    usage,
  };
}
