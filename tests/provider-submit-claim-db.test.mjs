import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDb, sql as sharedSql } from "../lib/db.ts";
import {
  claimProviderSubmission,
  failClosedStaleProviderSubmissions,
} from "../lib/provider-submit-claim.ts";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const db = hasDatabase ? requireDb() : null;

after(async () => {
  if (sharedSql) await sharedSql.end({ timeout: 1 });
});

async function createFixture() {
  if (!db) throw new Error("Database fixture requested without DATABASE_URL.");

  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const jobId = randomUUID();
  const attemptId = randomUUID();

  await db.begin(async (tx) => {
    await tx`insert into workspaces (id, name) values (${workspaceId}, 'provider-claim-test')`;
    await tx`insert into projects (id, workspace_id, name) values (${projectId}, ${workspaceId}, 'provider-claim-test')`;
    await tx`
      insert into generation_jobs (
        id, generation_request_id, workspace_id, project_id, model_id, status
      ) values (
        ${jobId}, ${randomUUID()}, ${workspaceId}, ${projectId}, 'veo-3.1-generate-preview', 'submitting'
      )
    `;
    await tx`
      insert into generation_attempts (
        id, generation_job_id, provider, model_id, status
      ) values (
        ${attemptId}, ${jobId}, 'google', 'veo-3.1-generate-preview', 'submitting'
      )
    `;
  });

  return { workspaceId, projectId, jobId, attemptId };
}

async function cleanupFixture(workspaceId) {
  if (!db) return;
  await db`delete from workspaces where id = ${workspaceId}`;
}

test(
  "provider submission claim is one-shot in PostgreSQL",
  { skip: !hasDatabase },
  async () => {
    const fixture = await createFixture();
    try {
      const first = await claimProviderSubmission(fixture.attemptId);
      const replay = await claimProviderSubmission(fixture.attemptId);

      assert.equal(first.claimed, true);
      assert.equal(first.status, "provider_submit_claimed");
      assert.equal(replay.claimed, false);
      assert.equal(replay.status, "provider_submit_claimed");
      assert.equal(replay.providerOperationId, null);

      const rows = await db`
        select status, provider_operation_id
        from generation_attempts
        where id = ${fixture.attemptId}
      `;
      assert.equal(rows[0]?.status, "provider_submit_claimed");
      assert.equal(rows[0]?.provider_operation_id, null);
    } finally {
      await cleanupFixture(fixture.workspaceId);
    }
  },
);

test(
  "stale claimed submission becomes failed_ambiguous without provider operation",
  { skip: !hasDatabase },
  async () => {
    const fixture = await createFixture();
    try {
      const first = await claimProviderSubmission(fixture.attemptId);
      assert.equal(first.claimed, true);

      await db`
        update generation_attempts
        set started_at = now() - interval '31 seconds'
        where id = ${fixture.attemptId}
      `;

      const failed = await failClosedStaleProviderSubmissions(30, 100);
      assert.ok(
        failed.some((item) => item.attemptId === fixture.attemptId && item.jobId === fixture.jobId),
        "stale claimed attempt must be detected",
      );

      const attempts = await db`
        select status, error_code, provider_operation_id
        from generation_attempts
        where id = ${fixture.attemptId}
      `;
      const jobs = await db`select status from generation_jobs where id = ${fixture.jobId}`;

      assert.equal(attempts[0]?.status, "failed_ambiguous");
      assert.equal(attempts[0]?.error_code, "AMBIGUOUS_SUBMISSION_PROCESS_INTERRUPTION");
      assert.equal(attempts[0]?.provider_operation_id, null);
      assert.equal(jobs[0]?.status, "failed_ambiguous");
    } finally {
      await cleanupFixture(fixture.workspaceId);
    }
  },
);
