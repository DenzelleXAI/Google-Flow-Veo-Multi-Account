import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL or LOCAL_DATABASE_URL is required.");
  process.exit(1);
}

const isLocal = /(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(connectionString);
const sql = postgres(connectionString, {
  ssl: isLocal || process.env.DATABASE_SSL === "false" ? false : "require",
  max: 1,
});

const requiredTables = [
  "workspaces",
  "workspace_settings",
  "projects",
  "scenes",
  "scene_prompt_versions",
  "assets",
  "asset_locations",
  "devices",
  "api_profiles",
  "generation_jobs",
  "generation_attempts",
  "generation_outputs",
  "generation_job_assets",
  "agent_threads",
  "agent_messages",
  "research_sessions",
  "research_sources",
];

const requiredColumns = [
  ["assets", "mime_type"],
  ["assets", "relay_delete_after"],
  ["assets", "relay_deleted_at"],
  ["assets", "veo_reference_refreshed_at"],
  ["generation_jobs", "generation_mode"],
  ["generation_jobs", "extension_depth"],
  ["generation_jobs", "expected_output_duration_seconds"],
  ["workspace_settings", "daily_spend_limit_usd"],
  ["workspace_settings", "monthly_spend_limit_usd"],
  ["workspace_settings", "per_request_spend_limit_usd"],
];

try {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${requiredTables})
  `;
  const found = new Set(rows.map((row) => String(row.table_name)));
  const missingTables = requiredTables.filter((name) => !found.has(name));

  const columnRows = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `;
  const foundColumns = new Set(
    columnRows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
  );
  const missingColumns = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((name) => !foundColumns.has(name));

  const fkRows = await sql`
    select condeferrable, condeferred
    from pg_constraint
    where conrelid = 'generation_job_assets'::regclass
      and conname = 'generation_job_assets_asset_id_fkey'
      and contype = 'f'
    limit 1
  `;
  const inputAssetFk = fkRows[0];
  const deferredInputAssetFk = Boolean(inputAssetFk?.condeferrable && inputAssetFk?.condeferred);

  if (missingTables.length || missingColumns.length || !deferredInputAssetFk) {
    if (missingTables.length) {
      console.error(`Database is reachable but schema is incomplete. Missing tables: ${missingTables.join(", ")}`);
    }
    if (missingColumns.length) {
      console.error(`Database is reachable but schema is incomplete. Missing columns: ${missingColumns.join(", ")}`);
    }
    if (!deferredInputAssetFk) {
      console.error("generation_job_assets_asset_id_fkey must be DEFERRABLE INITIALLY DEFERRED.");
    }
    process.exitCode = 1;
  } else {
    const version = await sql`select version()`;
    console.log("Database connection: OK");
    console.log(`Schema tables: ${requiredTables.length}/${requiredTables.length} present`);
    console.log(`Critical columns: ${requiredColumns.length}/${requiredColumns.length} present`);
    console.log("Generation input asset FK: DEFERRABLE INITIALLY DEFERRED");
    console.log(`Server: ${String(version[0]?.version ?? "PostgreSQL")}`);
  }
} finally {
  await sql.end();
}
