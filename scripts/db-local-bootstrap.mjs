import { spawn } from "node:child_process";
import path from "node:path";

const databaseUrl = process.env.LOCAL_DATABASE_URL || "postgres://flow:flow_local_dev@127.0.0.1:54329/flow_studio";
const script = path.join(process.cwd(), "scripts", "db-bootstrap.mjs");

const child = spawn(process.execPath, [script], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: "false",
  },
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
