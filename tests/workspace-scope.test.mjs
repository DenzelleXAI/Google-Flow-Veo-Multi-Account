import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspaceSource = await readFile(new URL("../lib/workspace.ts", import.meta.url), "utf8");
const accessSource = await readFile(new URL("../lib/generation-access.ts", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("../app/api/generations/[jobId]/route.ts", import.meta.url), "utf8");
const retryRoute = await readFile(new URL("../app/api/generations/[jobId]/retry/route.ts", import.meta.url), "utf8");
const extendRoute = await readFile(new URL("../app/api/generations/[jobId]/extend/route.ts", import.meta.url), "utf8");

test("scene reads and writes enforce current workspace", () => {
  assert.match(workspaceSource, /join projects p on p\.id = s\.project_id/);
  assert.match(workspaceSource, /p\.workspace_id = \$\{workspace\.id\}/);
  assert.match(workspaceSource, /insert into scenes[\s\S]*select p\.id, \$\{title\}[\s\S]*p\.workspace_id = \$\{workspace\.id\}/);
  assert.match(workspaceSource, /Scene not found in current workspace/);
});

test("generation access guard scopes raw job IDs to current workspace", () => {
  assert.match(accessSource, /ensurePersonalWorkspace\(\)/);
  assert.match(accessSource, /where id = \$\{jobId\}[\s\S]*workspace_id = \$\{workspace\.id\}/);
});

test("API-facing generation detail, retry, and extension routes invoke workspace guard first", () => {
  for (const source of [detailRoute, retryRoute, extendRoute]) {
    const guard = source.indexOf("assertGenerationJobInCurrentWorkspace(jobId)");
    const rawRead = source.indexOf("getGenerationJob(jobId)");
    assert.ok(guard >= 0, "route must check workspace ownership");
    assert.ok(rawRead === -1 || guard < rawRead, "workspace guard must run before raw generation read");
  }
});
