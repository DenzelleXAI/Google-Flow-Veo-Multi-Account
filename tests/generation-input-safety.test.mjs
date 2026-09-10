import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generation transaction validates scene ownership before queue", async () => {
  const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");
  assert.match(source, /where id = \$\{sceneId\} and project_id = \$\{input\.projectId\}/);
  assert.match(source, /INVALID_SCENE/);
});

test("image inputs must belong to workspace project and remain available in relay", async () => {
  const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");
  assert.match(source, /p\.workspace_id = \$\{workspace\.id\}/);
  assert.match(source, /!asset\.r2_key \|\| asset\.relay_deleted_at/);
  assert.match(source, /startsWith\("image\/"\)/);
  assert.match(source, /INVALID_INPUT_ASSET/);
});

test("duplicate immutable input slots are rejected before insert", async () => {
  const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");
  assert.match(source, /const inputSlots = new Set<string>\(\)/);
  assert.match(source, /Duplicate generation input slot/);
});

test("idempotency is rechecked after workspace settings lock", async () => {
  const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");
  const lock = source.indexOf("for update", source.indexOf("from workspace_settings"));
  const recheck = source.indexOf("const existingAfterLock", lock);
  const usage = source.indexOf("const usageRows", recheck);
  assert.ok(lock >= 0, "workspace settings must be locked");
  assert.ok(recheck > lock, "idempotency must be rechecked after lock");
  assert.ok(usage > recheck, "duplicate request must return before consuming usage budget");
});

test("generation insert has conflict-safe idempotency fallback", async () => {
  const source = await readFile(new URL("../lib/generations.ts", import.meta.url), "utf8");
  assert.match(source, /on conflict \(workspace_id, generation_request_id\) do nothing/);
  assert.match(source, /Generation job insert lost an idempotency race/);
});
