import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../lib/generation-worker.ts", import.meta.url), "utf8");
const claimSource = await readFile(new URL("../lib/provider-submit-claim.ts", import.meta.url), "utf8");
const companionSource = await readFile(new URL("../companion/index.mjs", import.meta.url), "utf8");
const pathSafetySource = await readFile(new URL("../companion/path-safety.mjs", import.meta.url), "utf8");

test("paid provider call is preceded by a durable one-shot submission claim", () => {
  const claimIndex = workerSource.indexOf("claimProviderSubmission(attempt.id)");
  const providerIndex = workerSource.indexOf("submitVeoGeneration({");
  assert.notEqual(claimIndex, -1, "submission claim must exist");
  assert.notEqual(providerIndex, -1, "provider submit call must exist");
  assert.ok(claimIndex < providerIndex, "claim must occur before paid provider submit");
  assert.match(workerSource, /ProviderSubmissionReplayBlockedError/);
  assert.match(claimSource, /provider_submit_claimed/);
  assert.match(claimSource, /AMBIGUOUS_SUBMISSION_PROCESS_INTERRUPTION/);
});

test("stale claimed submissions are registered as a periodic fail-closed detector", () => {
  assert.match(workerSource, /detectStaleVeoSubmissions/);
  assert.match(workerSource, /failClosedStaleProviderSubmissions\(120, 100\)/);
  assert.match(workerSource, /CRITICAL: paid Veo submission became ambiguous after process interruption/);
});

test("companion verifies real parent containment before media writes", () => {
  assert.match(pathSafetySource, /export async function resolveMediaRoot/);
  assert.match(pathSafetySource, /return realpath\(mediaRoot\)/);
  assert.match(pathSafetySource, /export async function assertSafeParent/);
  assert.match(pathSafetySource, /await realpath\(parent\)/);
  assert.match(pathSafetySource, /info\.isSymbolicLink\(\)/);
  assert.match(companionSource, /const mediaRootReal = await resolveMediaRoot\(mediaRoot\)/);

  const firstGuard = companionSource.indexOf("await guardTarget(target);");
  const streamWrite = companionSource.indexOf("createWriteStream(part)");
  assert.notEqual(firstGuard, -1);
  assert.notEqual(streamWrite, -1);
  assert.ok(firstGuard < streamWrite, "real-path guard must run before writing the .part file");

  const secondGuard = companionSource.lastIndexOf("await guardTarget(target);");
  const renameIndex = companionSource.indexOf("await rename(part, target);");
  assert.ok(secondGuard < renameIndex && secondGuard > streamWrite, "parent must be rechecked immediately before final rename");
});
