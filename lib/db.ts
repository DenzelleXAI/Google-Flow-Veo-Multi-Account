import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

export const dbConfigured = Boolean(connectionString);

export const sql = connectionString
  ? postgres(connectionString, {
      ssl: process.env.DATABASE_SSL === "false" ? false : "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

export function requireDb() {
  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return sql;
}
