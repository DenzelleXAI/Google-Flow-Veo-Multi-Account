const baseUrl = (process.env.LOCAL_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

try {
  const response = await fetch(`${baseUrl}/api/dev/smoke`, { method: "POST" });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.ok) {
    console.error("Local smoke test failed.");
    console.error(body.error || `${response.status} ${response.statusText}`);
    process.exit(1);
  }

  console.log("Local smoke test: OK");
  for (const [name, value] of Object.entries(body.checks ?? {})) {
    console.log(`${value ? "OK" : "FAIL"}  ${name}`);
  }
  console.log("Temporary smoke-test records were cleaned up by the server.");
} catch (error) {
  console.error("Unable to reach the local app.");
  console.error(error instanceof Error ? error.message : error);
  console.error(`Start the app first with: npm run dev`);
  process.exit(1);
}
