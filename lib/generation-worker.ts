import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inngest } from "./inngest";
import {
  getGenerationJob,
  saveRelayOutput,
  startAttempt,
  updateAttempt,
  updateGenerationStatus,
} from "./generations";
import { resolveGoogleProfile } from "./provider-profiles";
import { createVeoClient, downloadVeoVideo, pollVeoOperation, submitVeoGeneration } from "./providers/veo";
import { uploadVideoToRelay } from "./r2";

export const runVeoGeneration = inngest.createFunction(
  {
    id: "run-veo-generation",
    name: "Run Veo generation",
    triggers: { event: "video/generation.requested" },
  },
  async ({ event, step }) => {
    const jobId = String(event.data.jobId);

    const job = await step.run("load-job", async () => {
      const found = await getGenerationJob(jobId);
      if (!found) throw new Error(`Generation job ${jobId} not found.`);
      return found;
    });

    if (["cloud_ready", "cancelled"].includes(job.status)) {
      return { jobId, status: job.status, skipped: true };
    }

    const resolved = await step.run("resolve-profile", async () => {
      return resolveGoogleProfile(job.requested_api_profile_id);
    });

    const attempt = await step.run("start-attempt", async () => {
      await updateGenerationStatus(jobId, "submitting");
      return startAttempt(jobId, resolved.profile.id, job.model_id);
    });

    let operation = await step.run("submit-veo", async () => {
      const submitted = await submitVeoGeneration({
        apiKey: resolved.apiKey,
        modelId: job.model_id,
        prompt: job.prompt_snapshot,
        aspectRatio: job.aspect_ratio_snapshot,
        resolution: job.resolution_snapshot,
      });
      await updateAttempt({
        attemptId: attempt.id,
        status: "provider_pending",
        providerOperationId: submitted.operation?.name ?? null,
      });
      await updateGenerationStatus(jobId, "provider_pending");
      return submitted.operation;
    });

    const ai = createVeoClient(resolved.apiKey);

    for (let poll = 0; poll < 180 && !operation.done; poll += 1) {
      await step.sleep(`poll-delay-${poll}`, "10s");
      operation = await step.run(`poll-veo-${poll}`, async () => {
        return pollVeoOperation(ai, operation);
      });
    }

    if (!operation.done) {
      await step.run("mark-timeout", async () => {
        await updateAttempt({
          attemptId: attempt.id,
          status: "failed_retryable",
          errorCode: "PROVIDER_TIMEOUT",
          errorMessage: "Veo operation did not complete within the polling window.",
          completed: true,
        });
        await updateGenerationStatus(jobId, "failed_retryable");
      });
      throw new Error("Veo generation polling timed out.");
    }

    const filename = `${job.id}.mp4`;

    try {
      const relay = await step.run("download-and-relay-output", async () => {
        const temp = await mkdtemp(join(tmpdir(), "persistent-veo-"));
        const localPath = join(temp, filename);
        try {
          await updateGenerationStatus(jobId, "downloading_from_provider");
          await downloadVeoVideo(ai, operation, localPath);
          await updateGenerationStatus(jobId, "uploading_relay");
          const key = `generations/${job.workspace_id}/${job.project_id}/${job.id}/${filename}`;
          return await uploadVideoToRelay({ path: localPath, key });
        } finally {
          await rm(temp, { recursive: true, force: true }).catch(() => undefined);
        }
      });

      const asset = await step.run("persist-output", async () => {
        const saved = await saveRelayOutput({
          jobId,
          projectId: job.project_id,
          filename,
          r2Key: relay.key,
          sha256: relay.sha256,
          fileSizeBytes: relay.bytes,
        });
        await updateAttempt({ attemptId: attempt.id, status: "completed", completed: true });
        await updateGenerationStatus(jobId, "cloud_ready");
        return saved;
      });

      return { jobId, status: "cloud_ready", assetId: asset.id, r2Key: relay.key };
    } catch (error) {
      await step.run("mark-failure", async () => {
        const message = error instanceof Error ? error.message : "Unknown generation error";
        await updateAttempt({
          attemptId: attempt.id,
          status: "failed_retryable",
          errorCode: "GENERATION_ERROR",
          errorMessage: message,
          completed: true,
        });
        await updateGenerationStatus(jobId, "failed_retryable");
      });
      throw error;
    }
  },
);
