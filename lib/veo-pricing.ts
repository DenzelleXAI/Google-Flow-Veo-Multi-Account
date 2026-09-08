export const VEO_PRICING_VERSION = "google-ai-pricing-2026-09-09";

type Resolution = "720p" | "1080p" | "4k";

type PriceTable = Record<Resolution, number | null>;

const pricesPerSecond: Record<string, PriceTable> = {
  "veo-3.1-generate-preview": {
    "720p": 0.4,
    "1080p": 0.4,
    "4k": 0.6,
  },
  "veo-3.1-fast-generate-preview": {
    "720p": 0.1,
    "1080p": 0.12,
    "4k": 0.3,
  },
  "veo-3.1-lite-generate-preview": {
    "720p": 0.05,
    "1080p": 0.08,
    "4k": null,
  },
};

function normalizeResolution(value: string): Resolution {
  const normalized = value.toLowerCase();
  if (normalized === "4k") return "4k";
  if (normalized === "1080p") return "1080p";
  return "720p";
}

export function estimateVeoCostUsd(input: {
  modelId: string;
  resolution: string;
  durationSeconds: number;
}) {
  const table = pricesPerSecond[input.modelId];
  if (!table) throw new Error(`No pricing is registered for ${input.modelId}.`);

  const resolution = normalizeResolution(input.resolution);
  const perSecondUsd = table[resolution];
  if (perSecondUsd === null) {
    throw new Error(`${input.modelId} does not support ${resolution} pricing/output.`);
  }

  const durationSeconds = Number(input.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Generation duration must be positive for cost estimation.");
  }

  const estimatedCostUsd = Math.round(perSecondUsd * durationSeconds * 10000) / 10000;
  return {
    estimatedCostUsd,
    perSecondUsd,
    pricingVersion: VEO_PRICING_VERSION,
  };
}
