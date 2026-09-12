import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type OperationsAlert = {
  severity: "critical" | "warning" | "info";
  code: string;
  title: string;
  detail: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
  alerts: OperationsAlert[];
  generations: {
    failedAmbiguous24h: number;
    failedFinal24h: number;
    failedRetryable24h: number;
    providerPending: number;
    cloudReady24h: number;
  };
  spend: {
    dailyReservedUsd: number;
    monthlyReservedUsd: number;
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    dailyPercent: number;
    monthlyPercent: number;
    dailyGenerationCount: number;
    monthlyGenerationCount: number;
    dailyGenerationLimit: number;
    monthlyGenerationLimit: number;
  };
  devices: Array<{
    id: string;
    name: string;
    status: string;
    secondsSinceSeen: number | null;
    freeDiskBytes: number | null;
    stale: boolean;
    lowDisk: boolean;
  }>;
  recentFailures: Array<{
    jobId: string;
    projectName: string;
    modelId: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: string | Date;
  }>;
};

function percentage(value: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.round((value / limit) * 1000) / 10);
}

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  await sql`
    insert into workspace_settings (workspace_id)
    values (${workspace.id})
    on conflict (workspace_id) do nothing
  `;

  const [settingsRows, usageRows, generationRows, deviceRows, failureRows] = await Promise.all([
    sql`
      select daily_generation_limit, monthly_generation_limit,
             daily_spend_limit_usd, monthly_spend_limit_usd,
             min_free_disk_bytes, device_stale_after_seconds
      from workspace_settings
      where workspace_id = ${workspace.id}
      limit 1
    `,
    sql`
      select
        count(*) filter (
          where created_at >= date_trunc('day', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        )::int as daily_count,
        count(*) filter (
          where created_at >= date_trunc('month', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        )::int as monthly_count,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('day', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        ), 0)::numeric as daily_reserved_usd,
        coalesce(sum(estimated_cost_usd) filter (
          where created_at >= date_trunc('month', now())
            and status <> 'cancelled'
            and (
              status <> 'failed_final'
              or exists (
                select 1 from generation_attempts ga
                where ga.generation_job_id = generation_jobs.id
                  and ga.provider_operation_id is not null
              )
            )
        ), 0)::numeric as monthly_reserved_usd
      from generation_jobs
      where workspace_id = ${workspace.id}
    `,
    sql`
      select
        count(*) filter (where status = 'failed_ambiguous' and updated_at >= now() - interval '24 hours')::int as failed_ambiguous_24h,
        count(*) filter (where status = 'failed_final' and updated_at >= now() - interval '24 hours')::int as failed_final_24h,
        count(*) filter (where status = 'failed_retryable' and updated_at >= now() - interval '24 hours')::int as failed_retryable_24h,
        count(*) filter (where status = 'provider_pending')::int as provider_pending,
        count(*) filter (where status in ('cloud_ready', 'local_confirmed') and updated_at >= now() - interval '24 hours')::int as cloud_ready_24h
      from generation_jobs
      where workspace_id = ${workspace.id}
    `,
    sql`
      select id, name, status, free_disk_bytes, last_seen_at,
             extract(epoch from (now() - last_seen_at))::int as seconds_since_seen
      from devices
      where workspace_id = ${workspace.id}
      order by name asc
    `,
    sql`
      select
        j.id as job_id,
        p.name as project_name,
        j.model_id,
        j.status,
        latest.error_code,
        latest.error_message,
        j.updated_at
      from generation_jobs j
      join projects p on p.id = j.project_id
      left join lateral (
        select a.error_code, a.error_message
        from generation_attempts a
        where a.generation_job_id = j.id
        order by a.started_at desc
        limit 1
      ) latest on true
      where j.workspace_id = ${workspace.id}
        and j.status in ('failed_ambiguous', 'failed_final', 'failed_retryable')
      order by j.updated_at desc
      limit 25
    `,
  ]);

  const settings = settingsRows[0];
  const usage = usageRows[0];
  const generations = generationRows[0];

  const dailyReservedUsd = Number(usage?.daily_reserved_usd ?? 0);
  const monthlyReservedUsd = Number(usage?.monthly_reserved_usd ?? 0);
  const dailyLimitUsd = Number(settings?.daily_spend_limit_usd ?? 0);
  const monthlyLimitUsd = Number(settings?.monthly_spend_limit_usd ?? 0);
  const dailyGenerationCount = Number(usage?.daily_count ?? 0);
  const monthlyGenerationCount = Number(usage?.monthly_count ?? 0);
  const dailyGenerationLimit = Number(settings?.daily_generation_limit ?? 0);
  const monthlyGenerationLimit = Number(settings?.monthly_generation_limit ?? 0);
  const staleAfterSeconds = Number(settings?.device_stale_after_seconds ?? 300);
  const minFreeDiskBytes = Number(settings?.min_free_disk_bytes ?? 0);

  const devices = Array.from(deviceRows).map((row) => {
    const secondsSinceSeen = row.last_seen_at === null ? null : Number(row.seconds_since_seen);
    const freeDiskBytes = row.free_disk_bytes === null ? null : Number(row.free_disk_bytes);
    const stale = secondsSinceSeen === null || secondsSinceSeen > staleAfterSeconds;
    const lowDisk = !stale && freeDiskBytes !== null && freeDiskBytes < minFreeDiskBytes;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      secondsSinceSeen,
      freeDiskBytes,
      stale,
      lowDisk,
    };
  });

  const failedAmbiguous24h = Number(generations?.failed_ambiguous_24h ?? 0);
  const failedFinal24h = Number(generations?.failed_final_24h ?? 0);
  const failedRetryable24h = Number(generations?.failed_retryable_24h ?? 0);
  const providerPending = Number(generations?.provider_pending ?? 0);
  const cloudReady24h = Number(generations?.cloud_ready_24h ?? 0);
  const dailyPercent = percentage(dailyReservedUsd, dailyLimitUsd);
  const monthlyPercent = percentage(monthlyReservedUsd, monthlyLimitUsd);

  const alerts: OperationsAlert[] = [];
  if (failedAmbiguous24h > 0) {
    alerts.push({
      severity: "critical",
      code: "FAILED_AMBIGUOUS",
      title: `${failedAmbiguous24h} ambiguous paid submission${failedAmbiguous24h === 1 ? "" : "s"} in 24h`,
      detail: "Do not auto-resubmit. Review the generation attempt and Google billing/provider state first.",
    });
  }
  if (failedFinal24h > 0 || failedRetryable24h > 0) {
    alerts.push({
      severity: "warning",
      code: "PROVIDER_FAILURES",
      title: `${failedFinal24h + failedRetryable24h} failed generation${failedFinal24h + failedRetryable24h === 1 ? "" : "s"} in 24h`,
      detail: `${failedFinal24h} final; ${failedRetryable24h} retryable. Inspect the latest provider error codes before retrying.`,
    });
  }
  for (const device of devices) {
    if (device.lowDisk) {
      alerts.push({
        severity: "warning",
        code: "LOW_DISK",
        title: `${device.name} is below the configured disk reserve`,
        detail: "New local delivery may fail even though R2 continues to protect cloud-ready outputs.",
      });
    } else if (device.stale) {
      alerts.push({
        severity: "info",
        code: "STALE_DEVICE",
        title: `${device.name} telemetry is stale`,
        detail: "The desktop companion is offline or has not reported within the configured freshness window.",
      });
    }
  }
  if (dailyPercent >= 80) {
    alerts.push({
      severity: dailyPercent >= 100 ? "critical" : "warning",
      code: "DAILY_SPEND",
      title: `Daily reserved spend is ${dailyPercent.toFixed(1)}% of cap`,
      detail: `$${dailyReservedUsd.toFixed(2)} reserved of $${dailyLimitUsd.toFixed(2)}.`,
    });
  }
  if (monthlyPercent >= 80) {
    alerts.push({
      severity: monthlyPercent >= 100 ? "critical" : "warning",
      code: "MONTHLY_SPEND",
      title: `Monthly reserved spend is ${monthlyPercent.toFixed(1)}% of cap`,
      detail: `$${monthlyReservedUsd.toFixed(2)} reserved of $${monthlyLimitUsd.toFixed(2)}.`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    generations: {
      failedAmbiguous24h,
      failedFinal24h,
      failedRetryable24h,
      providerPending,
      cloudReady24h,
    },
    spend: {
      dailyReservedUsd,
      monthlyReservedUsd,
      dailyLimitUsd,
      monthlyLimitUsd,
      dailyPercent,
      monthlyPercent,
      dailyGenerationCount,
      monthlyGenerationCount,
      dailyGenerationLimit,
      monthlyGenerationLimit,
    },
    devices,
    recentFailures: Array.from(failureRows).map((row) => ({
      jobId: String(row.job_id),
      projectName: String(row.project_name),
      modelId: String(row.model_id),
      status: String(row.status),
      errorCode: row.error_code === null ? null : String(row.error_code),
      errorMessage: row.error_message === null ? null : String(row.error_message),
      updatedAt: row.updated_at as string | Date,
    })),
  };
}
