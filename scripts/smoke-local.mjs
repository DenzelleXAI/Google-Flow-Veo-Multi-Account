const baseUrl = (process.env.LOCAL_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const checks = [
  { name: "Core persistence", path: "/api/dev/smoke" },
  { name: "Asset/media persistence", path: "/api/dev/smoke-library" },
];

try {
  for (const check of checks) {
    const response = await fetch(`${baseUrl}${check.path}`, { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      console.error(`${check.name} smoke test failed.`);
      console.error(body.error || `${response.status} ${response.statusText}`);
      process.exit(1);
    }

    console.log(`${check.name}: OK`);
    for (const [name, value] of Object.entries(body.checks ?? {})) {
      console.log(`${value ? "OK" : "FAIL"}  ${name}`);
    }
  }

  console.log("Local smoke suite: OK");
  console.log("Temporary smoke-test records were cleaned up by the server.");
} catch (error) {
  console.error("Unable to complete the local smoke suite.");
  console.error(error instanceof Error ? error.message : error);
  console.error(`Start the app first with: npm run dev`);
  process.exit(1);
}
