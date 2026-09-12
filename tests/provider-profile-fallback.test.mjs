import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/provider-profiles.ts", import.meta.url), "utf8");

test("profile loading requires enabled=true", () => {
  assert.match(source, /async function loadProfile[\s\S]*and enabled = true/);
});

test("automatic fallback selects only enabled profiles", () => {
  assert.match(source, /async function loadEnabledFallbackProfile/);
  assert.match(source, /loadEnabledFallbackProfile[\s\S]*enabled = true/);
  assert.match(source, /await ensureEnvironmentGoogleProfile\(\);\s*profile = await loadEnabledFallbackProfile\(\);/);
});

test("explicit profile request never silently falls back", () => {
  const explicitStart = source.indexOf("if (requestedProfileId)");
  const elseStart = source.indexOf("} else {", explicitStart);
  const explicitBlock = source.slice(explicitStart, elseStart);
  assert.match(explicitBlock, /profile = await loadProfile\(requestedProfileId\)/);
  assert.doesNotMatch(explicitBlock, /loadEnabledFallbackProfile/);
  assert.doesNotMatch(explicitBlock, /ensureEnvironmentGoogleProfile/);
});
