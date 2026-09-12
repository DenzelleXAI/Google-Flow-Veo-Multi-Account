import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");

test("generation transaction validates scene ownership before queue", () => {
  assert.match(source, /where id = \$\{sceneId\} and project_id = \$\{input\.projectId\}/);
  assert.match(source, /INVALID_SCENE/);
});

test("image inputs must belong to workspace project and remain available in relay", () => {
  assert.match(source, /p\.workspace_id = \$\{workspace\.id\}/);
  assert.match(source, /!asset\.r2_key \|\| asset\.relay_deleted_at/);
  assert.match(source, /startsWith\("image\/"\)/);
  assert.match(source, /INVALID_INPUT_ASSET/);
});

test("duplicate immutable input slots are rejected before insert", () => {
  assert.match(source, /const inputSlots = new Set<string>\(\)/);
  assert.match(source, /Duplicate generation input slot/);
});

test("idempotency is rechecked after workspace settings lock", () => {
  const lock = source.indexOf("for update", source.indexOf("from workspace_settings"));
  const recheck = source.indexOf("const existingAfterLock", lock);
  const usage = source.indexOf("const usageRows", recheck);
  assert.ok(lock >= 0, "workspace settings must be locked");
  assert.ok(recheck > lock, "idempotency must be rechecked after lock");
  assert.ok(usage > recheck, "duplicate request must return before consuming usage budget");
});

test("generation insert has conflict-safe idempotency fallback", () => {
  assert.match(source, /on conflict \(workspace_id, generation_request_id\) do nothing/);
  assert.match(source, /Generation job insert lost an idempotency race/);
});

test("provider-accepted final failures remain reserved in queue admission", () => {
  assert.match(source, /status <> 'failed_final'/);
  assert.match(source, /ga\.provider_operation_id is not null/);
  assert.doesNotMatch(source, /status not in \('cancelled', 'failed_final'\)/);
});

test("relay output persistence serializes on the job and reuses existing output", () => {
  const saveStart = source.indexOf("export async function saveRelayOutput");
  const jobLock = source.indexOf("for update", saveStart);
  const existing = source.indexOf("const existing = await tx", jobLock);
  const assetInsert = source.indexOf("insert into assets", existing);

  assert.ok(saveStart >= 0);
  assert.ok(jobLock > saveStart, "output persistence must lock the logical generation job");
  assert.ok(existing > jobLock, "existing output must be checked under the job lock");
  assert.match(source.slice(existing, assetInsert), /if \(existing\[0\]\) return existing\[0\]/);
  assert.ok(assetInsert > existing, "new asset may be inserted only after idempotent existing-output check");
});
