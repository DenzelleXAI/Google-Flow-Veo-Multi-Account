import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const monitoringSource = await readFile(new URL("../lib/operations-monitoring.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/system/monitoring/route.ts", import.meta.url), "utf8");
const navSource = await readFile(new URL("../app/utility-nav.tsx", import.meta.url), "utf8");

test("operations monitoring is workspace scoped", () => {
  assert.match(monitoringSource, /ensurePersonalWorkspace\(\)/);
  assert.match(monitoringSource, /workspace_id = \$\{workspace\.id\}/);
});

test("monitoring includes paid ambiguity, provider failure, disk, and spend signals", () => {
  for (const signal of [
    "FAILED_AMBIGUOUS",
    "PROVIDER_FAILURES",
    "LOW_DISK",
    "STALE_DEVICE",
    "DAILY_SPEND",
    "MONTHLY_SPEND",
  ]) {
    assert.match(monitoringSource, new RegExp(signal));
  }
  assert.match(monitoringSource, /Do not auto-resubmit/);
});

test("monitoring API is no-store and exposes no credential fields", () => {
  assert.match(routeSource, /cache-control.*no-store/i);
  assert.doesNotMatch(monitoringSource, /encrypted_credential/);
  assert.doesNotMatch(monitoringSource, /api_key/i);
  assert.doesNotMatch(monitoringSource, /companion_token/i);
});

test("monitoring dashboard is discoverable", () => {
  assert.match(navSource, /href="\/monitoring"/);
});
