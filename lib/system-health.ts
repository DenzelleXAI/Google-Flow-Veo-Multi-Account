import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { GoogleGenAI } from "@google/genai";
import { dbConfigured, requireDb } from "./db";
import { resolveGoogleProfile } from "./provider-profiles";
import { createR2Client } from "./r2";

type HealthState = "ready" | "missing" | "error" | "unchecked";

export type HealthCheck = {
  state: HealthState;
  detail: string;
};

export type SystemHealth = {
  readyForPaidGeneration: boolean;
  checks: {
    database: HealthCheck;
    google: HealthCheck;
    r2: HealthCheck;
    inngest: HealthCheck;
    credentialEncryption: HealthCheck;
    companion: HealthCheck;
  };
};

function configured(...names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function hasEnvironmentGoogleCredential() {
  return configured("GOOGLE_AUTH_KEY") || configured("GEMINI_API_KEY") || configured("GOOGLE_API_KEY");
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return "Health check failed.";
}

async function verifyRequiredSchema() {
  const sql = requireDb();

  const rows = await sql`
    select
      to_regclass('public.workspaces') is not null as workspaces_ok,
      to_regclass('public.projects') is not null as projects_ok,
      to_regclass('public.scenes') is not null as scenes_ok,
      to_regclass('public.api_profiles') is not null as profiles_ok,
      to_regclass('public.generation_jobs') is not null as generation_jobs_ok,
      to_regclass('public.generation_attempts') is not null as generation_attempts_ok,
      to_regclass('public.assets') is not null as assets_ok,
      to_regclass('public.asset_locations') is not null as asset_locations_ok,
      to_regclass('public.agent_threads') is not null as agent_threads_ok,
      to_regclass('public.research_sessions') is not null as research_sessions_ok
  `;

  const required = rows[0] ?? {};
  const missingTables = Object.entries(required)
    .filter(([, present]) => !present)
    .map(([name]) => name.replace(/_ok$/, ""));

  if (missingTables.length) {
    throw new Error(`Database schema is incomplete. Missing tables: ${missingTables.join(", ")}. Run npm run db:bootstrap.`);
  }

  await sql`
    select
      estimated_cost_usd,
      pricing_version,
      requested_api_profile_id,
      target_device_id,
      parent_generation_job_id,
      generation_mode,
      extension_depth,
      expected_output_duration_seconds
    from generation_jobs
    limit 0
  `;

  await sql`
    select
      daily_generation_limit,
      monthly_generation_limit,
      daily_spend_limit_usd,
      monthly_spend_limit_usd,
      per_request_spend_limit_usd,
      min_free_disk_bytes,
      device_stale_after_seconds
    from workspace_settings
    limit 0
  `;

  await sql`
    select
      r2_key,
      relay_delete_after,
      relay_deleted_at,
      veo_reference_refreshed_at,
      duration_seconds
    from assets
    limit 0
  `;
}

export async function getSystemHealth(deep = false): Promise<SystemHealth> {
  const envGoogleConfigured = hasEnvironmentGoogleCredential();

  const checks: SystemHealth["checks"] = {
    database: {
      state: dbConfigured ? "unchecked" : "missing",
      detail: dbConfigured ? "DATABASE_URL is configured." : "DATABASE_URL is missing.",
    },
    google: {
      state: dbConfigured || envGoogleConfigured ? "unchecked" : "missing",
      detail: envGoogleConfigured
        ? "A server-side Google credential is configured."
        : dbConfigured
          ? "Google profile availability will be resolved from PostgreSQL."
          : "No server-side Google credential or database profile can be resolved.",
    },
    r2: {
      state: configured("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET") ? "unchecked" : "missing",
      detail: configured("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
        ? "R2 relay configuration is present."
        : "R2 relay configuration is incomplete.",
    },
    inngest: {
      state: configured("INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY") ? "ready" : "missing",
      detail: configured("INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY")
        ? "Inngest event and signing keys are configured."
        : "INNGEST_EVENT_KEY and/or INNGEST_SIGNING_KEY is missing.",
    },
    credentialEncryption: {
      state: configured("CREDENTIAL_ENCRYPTION_KEY") ? "ready" : "missing",
      detail: configured("CREDENTIAL_ENCRYPTION_KEY")
        ? "Encrypted multi-profile credential storage is configured."
        : "CREDENTIAL_ENCRYPTION_KEY is missing; environment-only profiles can still work.",
    },
    companion: {
      state: configured("COMPANION_TOKEN") ? "ready" : "missing",
      detail: configured("COMPANION_TOKEN")
        ? "Desktop companion authentication is configured."
        : "COMPANION_TOKEN is missing; cloud generation can still complete to R2.",
    },
  };

  if (deep && dbConfigured) {
    try {
      const sql = requireDb();
      await sql`select 1 as ok`;
      await verifyRequiredSchema();
      checks.database = { state: "ready", detail: "PostgreSQL connection succeeded and the required schema is present." };
    } catch (error) {
      checks.database = { state: "error", detail: safeError(error) };
    }
  } else if (dbConfigured) {
    checks.database.state = "ready";
  }

  if (deep && checks.database.state === "ready") {
    try {
      const resolved = await resolveGoogleProfile(null);
      const ai = new GoogleGenAI({ apiKey: resolved.apiKey });
      const pager = await ai.models.list({ config: { pageSize: 1 } });
      let model: string | null = null;
      for await (const item of pager) {
        model = item.name ?? null;
        break;
      }
      checks.google = {
        state: "ready",
        detail: model
          ? `Google profile '${resolved.profile.name}' accepted; model listing succeeded (${model}).`
          : `Google profile '${resolved.profile.name}' accepted.`,
      };
    } catch (error) {
      checks.google = { state: "error", detail: safeError(error) };
    }
  } else if (!deep && envGoogleConfigured) {
    checks.google.state = "ready";
  }

  if (deep && checks.r2.state !== "missing") {
    try {
      const { client, bucket } = createR2Client();
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      checks.r2 = { state: "ready", detail: "R2 bucket is reachable with the configured credentials." };
    } catch (error) {
      checks.r2 = { state: "error", detail: safeError(error) };
    }
  } else if (checks.r2.state !== "missing") {
    checks.r2.state = "ready";
  }

  const paidRequired: Array<keyof SystemHealth["checks"]> = ["database", "google", "r2", "inngest"];
  const readyForPaidGeneration = paidRequired.every((key) => checks[key].state === "ready");

  return { readyForPaidGeneration, checks };
}
