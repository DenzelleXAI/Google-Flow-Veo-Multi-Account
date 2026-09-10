import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PAID_VEO_HTTP_OPTIONS } from "../lib/providers/veo.ts";

test("paid Veo submission allows exactly one SDK HTTP attempt", () => {
  assert.equal(PAID_VEO_HTTP_OPTIONS.retryOptions.attempts, 1);
});

test("paid Veo worker durably claims before calling generateVideos", async () => {
  const source = await readFile(new URL("../lib/generation-worker.ts", import.meta.url), "utf8");
  const submitStepStart = source.indexOf('step.run("submit-veo-once"');
  const claimIndex = source.indexOf("claimProviderSubmission(attempt.id)", submitStepStart);
  const providerIndex = source.indexOf("submitVeoGeneration({", submitStepStart);

  assert.ok(submitStepStart >= 0, "submit-veo-once step must exist");
  assert.ok(claimIndex > submitStepStart, "provider submission claim must be inside the paid step");
  assert.ok(providerIndex > claimIndex, "claim must be persisted before the paid provider call");
});

test("replayed consumed provider claim fails closed instead of resubmitting", async () => {
  const source = await readFile(new URL("../lib/generation-worker.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!claim\.claimed\)/);
  assert.match(source, /ProviderSubmissionReplayBlockedError/);
  assert.match(source, /failed_ambiguous/);
});

test("stale claimed submissions have a scheduled fail-closed detector", async () => {
  const worker = await readFile(new URL("../lib/generation-worker.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/inngest/route.ts", import.meta.url), "utf8");

  assert.match(worker, /detectStaleVeoSubmissions/);
  assert.match(worker, /failClosedStaleProviderSubmissions\(120, 100\)/);
  assert.match(route, /detectStaleVeoSubmissions/);
});
