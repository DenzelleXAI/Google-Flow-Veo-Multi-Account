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

try {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${requiredTables})
  `;
  const found = new Set(rows.map((row) => String(row.table_name)));
  const missing = requiredTables.filter((name) => !found.has(name));

  if (missing.length) {
    console.error(`Database is reachable but schema is incomplete. Missing: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    const version = await sql`select version()`;
    console.log("Database connection: OK");
    console.log(`Schema tables: ${requiredTables.length}/${requiredTables.length} present`);
    console.log(`Server: ${String(version[0]?.version ?? "PostgreSQL")}`);
  }
} finally {
  await sql.end();
}
