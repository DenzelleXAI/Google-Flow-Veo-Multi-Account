import { NonRetriableError } from "inngest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inngest } from "./inngest";
import { markExtensionSourceReferenced } from "./extensions";
import {
  getGenerationJob,
  saveRelayOutput,
  startAttempt,
  updateAttempt,
  updateGenerationStatus,
} from "./generations";
import { requireDb } from "./db";
import { resolveGoogleProfile } from "./provider-profiles";
import { createVeoClient, downloadVeoVideo, pollVeoOperation, submitVeoGeneration } from "./providers/veo";
import { downloadRelayObject, uploadVideoToRelay } from "./r2";

async function loadVeoInputs(job: any) {
  const inputs = Array.isArray(job.inputs) ? job.inputs : [];

  async function loadImage(input: any) {
    if (!input?.r2_key || input.relay_deleted_at) {
      throw new NonRetriableError(`Asset ${input?.asset_id ?? "unknown"} is not available in R2.`);
    }
    if (!input?.mime_type?.startsWith("image/")) {
      throw new NonRetriableError(`Asset ${input.asset_id} is not a supported image.`);
    }
    return {
      bytes: await downloadRelayObject(input.r2_key),
      mimeType: input.mime_type,
    };
  }

  async function loadVideo(input: any) {
    if (!input?.r2_key || input.relay_deleted_at) {
      throw new NonRetriableError(`Extension source ${input?.asset_id ?? "unknown"} is not available in R2.`);
    }
    if (input.type !== "GENERATED_VIDEO" || !input?.mime_type?.startsWith("video/")) {
      throw new NonRetriableError("Veo extension source must be an app-recorded generated video.");
    }
    return {
      bytes: await downloadRelayObject(input.r2_key),
      mimeType: input.mime_type,
    };
  }

  const initial = inputs.find((item: any) => item.role === "initial_frame");
  const last = inputs.find((item: any) => item.role === "last_frame");
  const extension = inputs.find((item: any) => item.role === "extension_source");
  const references = inputs
    .filter((item: any) => item.role === "reference_asset")
    .sort((a: any, b: any) => Number(a.sort_order) - Number(b.sort_order));

  if (references.length > 3) {
    throw new NonRetriableError("Veo supports at most three reference images.");
  }
  if (job.generation_mode === "extend" && !extension) {
    throw new NonRetriableError("Extension job has no frozen source video.");
  }
  if (job.generation_mode !== "extend" && extension) {
    throw new NonRetriableError("A normal generation cannot contain an extension source.");
  }

  return {
    initialFrame: initial ? await loadImage(initial) : null,
    lastFrame: last ? await loadImage(last) : null,
    referenceImages: await Promise.all(references.map(loadImage)),
    extensionVideo: extension ? await loadVideo(extension) : null,
  };
}

async function refreshExtensionReferenceBestEffort(jobId: string) {
  try {
    await markExtensionSourceReferenced(jobId);
  } catch (error) {
    console.error("Failed to refresh extension source reference window", { jobId, error });
  }
}

export const submitVeoGenerationJob = inngest.createFunction(
  {
    id: "submit-veo-generation",
    name: "Submit Veo generation",
    triggers: { event: "video/generation.submit" },
    // Never automatically retry the function that contains the paid provider
    // submission. If the provider accepts the request but our response is lost,
    // an automatic retry could create a second billable generation.
    retries: 0,
  },
  async ({ event, step }) => {
    const jobId = String(event.data.jobId);
    const job = await step.run("load-job", async () => {
      const found = await getGenerationJob(jobId);
      if (!found) throw new NonRetriableError(`Generation job ${jobId} not found.`);
      return found;
    });

    const knownProviderAttempt = job.attempts.find((attempt) => Boolean(attempt.provider_operation_id));
    if (knownProviderAttempt) {
      return {
        jobId,
        status: job.status,
        skipped: true,
        reason: "provider-operation-already-exists",
        attemptId: knownProviderAttempt.id,
      };
    }

    if (!["queued", "failed_retryable"].includes(job.status)) {
      return { jobId, status: job.status, skipped: true, reason: "job-state-not-submittable" };
    }

    const resolved = await resolveGoogleProfile(job.requested_api_profile_id);
    const veoInputs = await loadVeoInputs(job);

    let attempt: Awaited<ReturnType<typeof startAttempt>>;
    try {
      attempt = await step.run("start-attempt", async () => {
        await updateGenerationStatus(jobId, "submitting");
        return startAttempt(jobId, resolved.profile.id, job.model_id);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create provider attempt";
      await updateGenerationStatus(jobId, "failed_retryable")
        .catch((markError) => console.error("Failed to mark pre-submit failure retryable", markError));
      throw new NonRetriableError(`Pre-submit setup failed before provider execution: ${message}`);
    }

    let operationName: string;
    try {
      operationName = await step.run("submit-veo-once", async () => {
        const submitted = await submitVeoGeneration({
          apiKey: resolved.apiKey,
          modelId: job.model_id,
          prompt: job.prompt_snapshot,
          aspectRatio: job.aspect_ratio_snapshot,
          resolution: job.resolution_snapshot,
          durationSeconds: job.duration_seconds_snapshot,
          initialFrame: veoInputs.initialFrame,
          lastFrame: veoInputs.lastFrame,
          referenceImages: veoInputs.referenceImages,
          extensionVideo: veoInputs.extensionVideo,
        });

        const name = submitted.operation?.name;
        if (!name) throw new Error("Veo accepted the request but returned no operation name.");

        // The paid submission step is not considered successful until the
        // provider operation ID is durably persisted in our own database.
        await updateAttempt({
          attemptId: attempt.id,
          status: "provider_pending",
          providerOperationId: name,
        });
        await updateGenerationStatus(jobId, "provider_pending");
        return name;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider submission error";
      await updateAttempt({
        attemptId: attempt.id,
        status: "failed_ambiguous",
        errorCode: "AMBIGUOUS_SUBMISSION",
        errorMessage: message,
        completed: true,
      }).catch((markError) => console.error("Failed to persist ambiguous attempt state", markError));
      await updateGenerationStatus(jobId, "failed_ambiguous")
        .catch((markError) => console.error("Failed to persist ambiguous job state", markError));
      throw new NonRetriableError(`Veo submission outcome is ambiguous: ${message}`);
    }

    // This bookkeeping is outside the paid/ambiguous boundary. Failure here
    // must never make a known provider operation look ambiguous.
    if (job.generation_mode === "extend") {
      await refreshExtensionReferenceBestEffort(jobId);
    }

    await step.sendEvent("dispatch-monitor", {
      id: `video-monitor-${attempt.id}`,
      name: "video/generation.monitor",
      data: {
        jobId,
        attemptId: attempt.id,
        apiProfileId: resolved.profile.id,
        operationName,
      },
    });

    return { jobId, status: "provider_pending", operationName };
  },
);

export const recoverPendingVeoMonitors = inngest.createFunction(
  {
    id: "recover-pending-veo-monitors",
    name: "Recover pending Veo monitors",
    triggers: { cron: "* * * * *" },
    retries: 3,
  },
  async ({ step }) => {
    const candidates = await step.run("load-provider-pending-attempts", async () => {
      const sql = requireDb();
      const rows = await sql`
        select
          j.id as job_id,
          a.id as attempt_id,
          a.api_profile_id,
          a.provider_operation_id
        from generation_jobs j
        join generation_attempts a on a.generation_job_id = j.id
        where j.status = 'provider_pending'
          and a.status = 'provider_pending'
          and a.provider_operation_id is not null
          and a.started_at <= now() - interval '30 seconds'
        order by a.started_at asc
        limit 100
      `;
      return Array.from(rows) as Array<{
        job_id: string;
        attempt_id: string;
        api_profile_id: string;
        provider_operation_id: string;
      }>;
    });

    for (const candidate of candidates) {
      await step.sendEvent(`recover-monitor-${candidate.attempt_id}`, {
        // Inngest event IDs deduplicate delivery for 24 hours. This makes the
        // immediate dispatch and recovery cron safe to overlap.
        id: `video-monitor-${candidate.attempt_id}`,
        name: "video/generation.monitor",
        data: {
          jobId: candidate.job_id,
          attemptId: candidate.attempt_id,
          apiProfileId: candidate.api_profile_id,
          operationName: candidate.provider_operation_id,
        },
      });
    }

    return { recovered: candidates.length };
  },
);

export const monitorVeoGeneration = inngest.createFunction(
  {
    id: "monitor-veo-generation",
    name: "Monitor and relay Veo generation",
    triggers: { event: "video/generation.monitor" },
    retries: 4,
  },
  async ({ event, step }) => {
    const jobId = String(event.data.jobId);
    const attemptId = String(event.data.attemptId);
    const apiProfileId = String(event.data.apiProfileId);
    const operationName = String(event.data.operationName);

    const job = await step.run("load-job", async () => {
      const found = await getGenerationJob(jobId);
      if (!found) throw new NonRetriableError(`Generation job ${jobId} not found.`);
      return found;
    });

    if (["cloud_ready", "local_confirmed", "cancelled"].includes(job.status)) {
      return { jobId, status: job.status, skipped: true };
    }

    // A previous monitor run may have persisted the output asset and then
    // failed before writing the terminal job/attempt statuses. In that case,
    // reconcile from our durable output instead of downloading and storing a
    // duplicate asset.
    if (job.outputs.length > 0) {
      const existingOutput = job.outputs[job.outputs.length - 1];
      await step.run("reconcile-existing-output", async () => {
        await updateAttempt({
          attemptId,
          status: "completed",
          errorCode: null,
          errorMessage: null,
          completed: true,
        });
        await updateGenerationStatus(jobId, "cloud_ready");
      });
      return {
        jobId,
        status: "cloud_ready",
        assetId: existingOutput.asset_id,
        r2Key: existingOutput.r2_key,
        reconciled: true,
      };
    }

    if (job.generation_mode === "extend") {
      await step.run("reconcile-extension-reference-window", async () => {
        await refreshExtensionReferenceBestEffort(jobId);
        return true;
      });
    }

    const resolved = await resolveGoogleProfile(apiProfileId);
    const ai = createVeoClient(resolved.apiKey);
    let operation: any = { name: operationName };

    for (let poll = 0; poll < 180; poll += 1) {
      operation = await step.run(`poll-veo-${poll}`, async () => {
        return pollVeoOperation(ai, operation);
      });
      if (operation.done) break;
      await step.sleep(`poll-delay-${poll}`, "10s");
    }

    if (!operation.done) {
      await step.run("mark-timeout", async () => {
        await updateAttempt({
          attemptId,
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
        await updateAttempt({ attemptId, status: "completed", completed: true });
        await updateGenerationStatus(jobId, "cloud_ready");
        return saved;
      });

      return { jobId, status: "cloud_ready", assetId: asset.id, r2Key: relay.key };
    } catch (error) {
      await step.run("mark-relay-failure", async () => {
        const message = error instanceof Error ? error.message : "Unknown generation relay error";
        await updateAttempt({
          attemptId,
          status: "failed_retryable",
          errorCode: "RELAY_ERROR",
          errorMessage: message,
          completed: true,
        });
        await updateGenerationStatus(jobId, "failed_retryable");
      });
      throw error;
    }
  },
);
