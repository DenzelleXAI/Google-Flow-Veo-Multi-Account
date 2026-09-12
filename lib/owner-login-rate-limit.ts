import { createHash } from "node:crypto";
import { requireDb } from "./db.ts";

export const OWNER_LOGIN_RATE_LIMIT = {
  maxFailures: 8,
  windowMinutes: 15,
  blockMinutes: 30,
} as const;

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  const sql = requireDb();
  await sql`
    create table if not exists owner_login_rate_limits (
      client_key text primary key,
      window_started_at timestamptz not null default now(),
      failure_count integer not null default 0,
      blocked_until timestamptz,
      updated_at timestamptz not null default now()
    )
  `;
  await sql`
    create index if not exists idx_owner_login_rate_limits_updated
    on owner_login_rate_limits(updated_at)
  `;
  tableReady = true;
}

function clientKey(clientAddress: string) {
  const secret = process.env.APP_SESSION_SECRET ?? "missing-session-secret";
  return createHash("sha256")
    .update("owner-login-rate-limit-v1\0")
    .update(secret)
    .update("\0")
    .update(clientAddress.trim().toLowerCase() || "unknown")
    .digest("hex");
}

export type OwnerLoginRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function checkOwnerLoginRateLimit(clientAddress: string): Promise<OwnerLoginRateLimitResult> {
  await ensureTable();
  const sql = requireDb();
  const key = clientKey(clientAddress);

  const rows = await sql`
    select
      failure_count,
      window_started_at,
      blocked_until,
      greatest(0, ceil(extract(epoch from (blocked_until - now()))))::int as retry_after_seconds
    from owner_login_rate_limits
    where client_key = ${key}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  if (row.blocked_until && Number(row.retry_after_seconds ?? 0) > 0) {
    return { allowed: false, retryAfterSeconds: Number(row.retry_after_seconds) };
  }

  const stale = await sql`
    select ${row.window_started_at}::timestamptz < now() - (${OWNER_LOGIN_RATE_LIMIT.windowMinutes} * interval '1 minute') as stale
  `;
  if (Boolean(stale[0]?.stale)) {
    await sql`
      update owner_login_rate_limits
      set failure_count = 0,
          window_started_at = now(),
          blocked_until = null,
          updated_at = now()
      where client_key = ${key}
    `;
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordOwnerLoginFailure(clientAddress: string): Promise<OwnerLoginRateLimitResult> {
  await ensureTable();
  const sql = requireDb();
  const key = clientKey(clientAddress);

  return sql.begin(async (tx) => {
    const rows = await tx`
      select failure_count, window_started_at, blocked_until
      from owner_login_rate_limits
      where client_key = ${key}
      for update
    `;
    const row = rows[0];

    if (!row) {
      await tx`
        insert into owner_login_rate_limits (
          client_key, window_started_at, failure_count, blocked_until, updated_at
        ) values (${key}, now(), 1, null, now())
      `;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const state = await tx`
      select
        ${row.window_started_at}::timestamptz < now() - (${OWNER_LOGIN_RATE_LIMIT.windowMinutes} * interval '1 minute') as window_stale,
        ${row.blocked_until}::timestamptz > now() as still_blocked,
        greatest(0, ceil(extract(epoch from (${row.blocked_until}::timestamptz - now()))))::int as retry_after_seconds
    `;
    const current = state[0];

    if (Boolean(current?.still_blocked)) {
      return {
        allowed: false,
        retryAfterSeconds: Number(current.retry_after_seconds ?? OWNER_LOGIN_RATE_LIMIT.blockMinutes * 60),
      };
    }

    const failures = Boolean(current?.window_stale) ? 1 : Number(row.failure_count ?? 0) + 1;
    const shouldBlock = failures >= OWNER_LOGIN_RATE_LIMIT.maxFailures;

    const updated = await tx`
      update owner_login_rate_limits
      set failure_count = ${failures},
          window_started_at = case when ${Boolean(current?.window_stale)} then now() else window_started_at end,
          blocked_until = case
            when ${shouldBlock} then now() + (${OWNER_LOGIN_RATE_LIMIT.blockMinutes} * interval '1 minute')
            else null
          end,
          updated_at = now()
      where client_key = ${key}
      returning greatest(0, ceil(extract(epoch from (blocked_until - now()))))::int as retry_after_seconds
    `;

    if (shouldBlock) {
      return {
        allowed: false,
        retryAfterSeconds: Number(updated[0]?.retry_after_seconds ?? OWNER_LOGIN_RATE_LIMIT.blockMinutes * 60),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export async function clearOwnerLoginFailures(clientAddress: string) {
  await ensureTable();
  const sql = requireDb();
  const key = clientKey(clientAddress);
  await sql`delete from owner_login_rate_limits where client_key = ${key}`;
}
