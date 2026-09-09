import { resolveGoogleProfile } from "./provider-profiles";
import { relayConfiguration } from "./r2";

export class GenerationInfrastructureError extends Error {
  constructor(
    public readonly code: "R2_NOT_CONFIGURED" | "INNGEST_NOT_CONFIGURED" | "GOOGLE_PROFILE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GenerationInfrastructureError";
  }
}

function has(name: string) {
  return Boolean(process.env[name]?.trim());
}

export async function assertGenerationInfrastructureReady(requestedApiProfileId?: string | null) {
  const relay = relayConfiguration();
  if (!relay.ready) {
    throw new GenerationInfrastructureError(
      "R2_NOT_CONFIGURED",
      `R2/S3 relay is not fully configured. Missing: ${relay.missing.join(", ")}.`,
    );
  }

  const missingInngest = ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"].filter((name) => !has(name));
  if (missingInngest.length) {
    throw new GenerationInfrastructureError(
      "INNGEST_NOT_CONFIGURED",
      `Durable generation workers are not fully configured. Missing: ${missingInngest.join(", ")}.`,
    );
  }

  try {
    const resolved = await resolveGoogleProfile(requestedApiProfileId ?? null);
    return { apiProfileId: resolved.profile.id };
  } catch (error) {
    throw new GenerationInfrastructureError(
      "GOOGLE_PROFILE_UNAVAILABLE",
      error instanceof Error ? error.message : "No usable Google profile is available.",
    );
  }
}
