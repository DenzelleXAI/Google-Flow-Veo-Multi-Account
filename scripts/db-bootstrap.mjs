import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const schemaPath = path.join(process.cwd(), "db", "schema.sql");
const schema = await fs.readFile(schemaPath, "utf8");
const sql = postgres(connectionString, {
  ssl: process.env.DATABASE_SSL === "false" ? false : "require",
  max: 1,
});

try {
  await sql.unsafe(schema);
  console.log("Database schema applied successfully.");
} finally {
  await sql.end();
}
