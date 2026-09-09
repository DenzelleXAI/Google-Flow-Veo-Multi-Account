import test from "node:test";
import assert from "node:assert/strict";
import { estimateVeoCostUsd, VEO_PRICING_VERSION } from "../lib/veo-pricing.ts";
import { validateVeoSettings } from "../lib/model-registry.ts";

test("Veo 3.1 Standard 1080p 8s costs $3.20", () => {
  const result = estimateVeoCostUsd({
    modelId: "veo-3.1-generate-preview",
    resolution: "1080p",
    durationSeconds: 8,
  });
  assert.equal(result.estimatedCostUsd, 3.2);
  assert.equal(result.perSecondUsd, 0.4);
  assert.equal(result.pricingVersion, VEO_PRICING_VERSION);
});

test("Veo 3.1 Standard 4K 8s costs $4.80", () => {
  const result = estimateVeoCostUsd({
    modelId: "veo-3.1-generate-preview",
    resolution: "4k",
    durationSeconds: 8,
  });
  assert.equal(result.estimatedCostUsd, 4.8);
});

test("Veo 3.1 Fast 1080p 8s costs $0.96", () => {
  const result = estimateVeoCostUsd({
    modelId: "veo-3.1-fast-generate-preview",
    resolution: "1080p",
    durationSeconds: 8,
  });
  assert.equal(result.estimatedCostUsd, 0.96);
});

test("Veo 3.1 Lite 1080p 8s costs $0.64", () => {
  const result = estimateVeoCostUsd({
    modelId: "veo-3.1-lite-generate-preview",
    resolution: "1080p",
    durationSeconds: 8,
  });
  assert.equal(result.estimatedCostUsd, 0.64);
});

test("Lite 4K is rejected by both capability and pricing rules", () => {
  assert.match(
    validateVeoSettings({
      modelId: "veo-3.1-lite-generate-preview",
      resolution: "4k",
      durationSeconds: 8,
      aspectRatio: "9:16",
    }) ?? "",
    /does not support 4k/i,
  );

  assert.throws(
    () => estimateVeoCostUsd({
      modelId: "veo-3.1-lite-generate-preview",
      resolution: "4k",
      durationSeconds: 8,
    }),
    /does not support 4k/i,
  );
});

test("1080p and 4K require 8 seconds", () => {
  assert.match(
    validateVeoSettings({
      modelId: "veo-3.1-generate-preview",
      resolution: "1080p",
      durationSeconds: 6,
      aspectRatio: "9:16",
    }) ?? "",
    /requires an 8-second duration/i,
  );

  assert.match(
    validateVeoSettings({
      modelId: "veo-3.1-fast-generate-preview",
      resolution: "4k",
      durationSeconds: 4,
      aspectRatio: "16:9",
    }) ?? "",
    /requires an 8-second duration/i,
  );
});

test("720p supports 4, 6, and 8 second generations", () => {
  for (const durationSeconds of [4, 6, 8]) {
    assert.equal(
      validateVeoSettings({
        modelId: "veo-3.1-generate-preview",
        resolution: "720p",
        durationSeconds,
        aspectRatio: "9:16",
      }),
      null,
    );
  }
});

test("unsupported model is rejected for both capability and pricing", () => {
  assert.match(
    validateVeoSettings({ modelId: "veo-unknown", resolution: "720p", durationSeconds: 8, aspectRatio: "9:16" }) ?? "",
    /unsupported veo model/i,
  );
  assert.throws(
    () => estimateVeoCostUsd({ modelId: "veo-unknown", resolution: "720p", durationSeconds: 8 }),
    /no pricing is registered/i,
  );
});

test("non-positive durations are rejected by pricing", () => {
  assert.throws(
    () => estimateVeoCostUsd({
      modelId: "veo-3.1-generate-preview",
      resolution: "720p",
      durationSeconds: 0,
    }),
    /duration must be positive/i,
  );
});
