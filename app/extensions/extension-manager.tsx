"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { veoModels, type VeoModelId } from "@/lib/model-registry";
import styles from "./extension-manager.module.css";

type GenerationJob = {
  id: string;
  status: string;
  generation_mode?: "generate" | "extend";
  parent_generation_job_id?: string | null;
  extension_depth?: number | null;
  expected_output_duration_seconds?: number | null;
  model_id: string;
  scene_title?: string | null;
  aspect_ratio_snapshot?: string | null;
  resolution_snapshot?: string | null;
  output_asset_id?: string | null;
  output_filename?: string | null;
  output_r2_key?: string | null;
  output_relay_deleted_at?: string | null;
  output_created_at?: string | null;
};

type ApiProfile = {
  id: string;
  name: string;
  enabled: boolean;
};

type ExtensionPreflight = {
  ok: boolean;
  parentJobId: string;
  expectedOutputDurationSeconds: number | null;
  extensionDepth: number | null;
  sourceReferenceExpiresAt: string | null;
  checks: Array<{ code: string; ok: boolean; message: string }>;
  generation: {
    usage: {
      daily: number;
      dailyLimit: number;
      monthly: number;
      monthlyLimit: number;
      dailyReservedUsd: number;
      dailySpendLimitUsd: number;
      monthlyReservedUsd: number;
      monthlySpendLimitUsd: number;
    };
    cost: {
      estimatedRequestUsd: number;
      perRequestLimitUsd: number;
      projectedDailyUsd: number;
      projectedMonthlyUsd: number;
      pricingVersion: string;
    } | null;
  } | null;
};

const extensionModels = (Object.entries(veoModels) as Array<[VeoModelId, (typeof veoModels)[VeoModelId]]>)
  .filter(([, capability]) => capability.supportsExtension)
  .map(([id, capability]) => ({ id, label: capability.label }));

const activeStatuses = new Set([
  "queued",
  "submitting",
  "provider_pending",
  "downloading_from_provider",
  "uploading_relay",
]);

function eligibility(job: GenerationJob) {
  if (!["cloud_ready", "local_confirmed"].includes(job.status)) return "Generation is not complete yet.";
  if (job.resolution_snapshot !== "720p") return "Only 720p Veo outputs can be extended.";
  if (!job.output_asset_id || !job.output_r2_key) return "No relay output is available yet.";
  if (job.output_relay_deleted_at) return "The source relay copy has already been deleted.";
  if (Number(job.extension_depth ?? 0) >= 20) return "This chain already reached the 20-extension limit.";
  if (Number(job.expected_output_duration_seconds ?? 0) > 141) return "The source is longer than Veo's 141-second extension input limit.";
  return null;
}

function labelForStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatUsd(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function ExtensionManager() {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [modelId, setModelId] = useState<VeoModelId>("veo-3.1-generate-preview");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [preflight, setPreflight] = useState<ExtensionPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const pendingRequestIds = useRef<Record<string, string>>({});

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const selectedEligibility = selectedJob ? eligibility(selectedJob) : "Choose a completed 720p generation.";
  const blockingChecks = preflight?.checks.filter((check) => !check.ok) ?? [];
  const preflightReady = Boolean(preflight?.ok && !selectedEligibility);

  async function refresh() {
    try {
      const [jobsResponse, profilesResponse] = await Promise.all([
        fetch("/api/generations", { cache: "no-store" }),
        fetch("/api/profiles", { cache: "no-store" }),
      ]);
      const jobsData = jobsResponse.ok ? await jobsResponse.json() : { jobs: [] };
      const profilesData = profilesResponse.ok ? await profilesResponse.json() : { profiles: [] };
      const nextJobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
      const nextProfiles = Array.isArray(profilesData.profiles) ? profilesData.profiles : [];
      setJobs(nextJobs);
      setProfiles(nextProfiles);
      setSelectedProfileId((current) => current || profilesData.defaultProfileId || nextProfiles.find((item: ApiProfile) => item.enabled)?.id || "");
      setSelectedJobId((current) => {
        if (current && nextJobs.some((job: GenerationJob) => job.id === current)) return current;
        return nextJobs.find((job: GenerationJob) => !eligibility(job))?.id ?? "";
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => activeStatuses.has(job.status))) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setPreflight(null);
      return;
    }

    let cancelled = false;
    setPreflightLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/generations/${selectedJobId}/extend/preflight`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            modelId,
            requestedApiProfileId: selectedProfileId || null,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!cancelled) {
          if (data && Array.isArray(data.checks)) setPreflight(data as ExtensionPreflight);
          else setPreflight(null);
        }
      } catch {
        if (!cancelled) setPreflight(null);
      } finally {
        if (!cancelled) setPreflightLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedJobId, selectedProfileId, modelId]);

  async function extendSelected() {
    if (!selectedJob || selectedEligibility || !preflightReady || submitting) return;
    const capability = veoModels[modelId];
    if (!capability.supportsExtension) {
      setMessage(`${capability.label} does not support extension.`);
      return;
    }

    let requestId = pendingRequestIds.current[selectedJob.id];
    if (!requestId) {
      requestId = crypto.randomUUID();
      pendingRequestIds.current[selectedJob.id] = requestId;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/generations/${selectedJob.id}/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationRequestId: requestId,
          modelId,
          promptSnapshot: prompt,
          requestedApiProfileId: selectedProfileId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok && !data.job) {
        throw new Error(data.error ?? "Extension was blocked.");
      }

      delete pendingRequestIds.current[selectedJob.id];
      setPrompt("");
      setMessage(`Extension job ${data.job.id} created. The source remains protected in R2 while the job is active.`);
      await refresh();
      if (data.job?.id) setSelectedJobId(data.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create extension job.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.card}>Loading Veo extension history…</div></main>;
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Veo 3.1 workflow</span>
        <h1>Extend a generated video</h1>
        <p>
          Extend a completed 720p Veo output by 7 seconds. Extension is explicit and billable, uses Standard or Fast only,
          and is capped at 20 steps per chain.
        </p>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Source</span><h2>Generation history</h2></div>
            <button onClick={() => void refresh()}>Refresh</button>
          </div>

          <div className={styles.list}>
            {jobs.length ? jobs.map((job) => {
              const reason = eligibility(job);
              const selected = job.id === selectedJobId;
              return (
                <button
                  key={job.id}
                  className={`${styles.job} ${selected ? styles.selected : ""}`}
                  onClick={() => { setSelectedJobId(job.id); setMessage(""); }}
                >
                  <div className={styles.jobTop}>
                    <strong>{job.scene_title ?? "Generation"}</strong>
                    <span>{labelForStatus(job.status)}</span>
                  </div>
                  <div className={styles.meta}>
                    {job.generation_mode === "extend" ? `Extension ${job.extension_depth ?? 0}` : "Base generation"}
                    {" · "}{job.resolution_snapshot ?? "—"}
                    {" · "}{job.expected_output_duration_seconds ?? "—"}s combined
                  </div>
                  <small className={reason ? styles.blocked : styles.ready}>
                    {reason ?? "Eligible for extension preflight"}
                  </small>
                </button>
              );
            }) : <div className={styles.empty}>No generations yet. Create a 720p video in Workspace first.</div>}
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.eyebrow}>Explicit paid action</span>
          <h2>Extension settings</h2>

          <label className={styles.field}>
            <span>Extension model</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value as VeoModelId)}>
              {extensionModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span>Google profile</span>
            <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
              {!profiles.length && <option value="">Default Google profile</option>}
              {profiles.filter((profile) => profile.enabled).map((profile) => (
                <option value={profile.id} key={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Continuation prompt <small>optional</small></span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Continue the action naturally while preserving the same subject, environment, lighting, and camera direction…"
            />
          </label>

          <div className={styles.rules}>
            <strong>Locked by provider rules</strong>
            <span>720p · API duration 8s · output adds 7s · maximum 20 extensions</span>
          </div>

          {selectedJob && (
            <div className={styles.selection}>
              <strong>Selected source</strong>
              <span>{selectedJob.output_filename ?? selectedJob.id}</span>
              <span>
                Depth {selectedJob.extension_depth ?? 0}/20 · {selectedJob.expected_output_duration_seconds ?? "—"}s → {Number(selectedJob.expected_output_duration_seconds ?? 0) + 7}s
              </span>
            </div>
          )}

          <div className={styles.preflight}>
            <div className={styles.preflightHeading}>
              <strong>Non-billable preflight</strong>
              <span className={preflightLoading ? styles.checking : preflightReady ? styles.readyBadge : styles.blockedBadge}>
                {preflightLoading ? "Checking…" : preflightReady ? "Ready" : "Blocked"}
              </span>
            </div>

            {preflight?.generation?.cost && (
              <div className={styles.costGrid}>
                <div><small>Request</small><strong>{formatUsd(preflight.generation.cost.estimatedRequestUsd)}</strong></div>
                <div><small>Per-request cap</small><strong>{formatUsd(preflight.generation.cost.perRequestLimitUsd)}</strong></div>
                <div><small>Projected today</small><strong>{formatUsd(preflight.generation.cost.projectedDailyUsd)}</strong></div>
                <div><small>Daily cap</small><strong>{formatUsd(preflight.generation.usage.dailySpendLimitUsd)}</strong></div>
                <div><small>Projected month</small><strong>{formatUsd(preflight.generation.cost.projectedMonthlyUsd)}</strong></div>
                <div><small>Monthly cap</small><strong>{formatUsd(preflight.generation.usage.monthlySpendLimitUsd)}</strong></div>
              </div>
            )}

            {preflight?.sourceReferenceExpiresAt && (
              <div className={styles.freshness}>
                <small>Provider extension window</small>
                <strong>Fresh until {formatDate(preflight.sourceReferenceExpiresAt)}</strong>
              </div>
            )}

            {!!blockingChecks.length && (
              <div className={styles.blockers}>
                {blockingChecks.map((check) => <div key={check.code}>✕ {check.message}</div>)}
              </div>
            )}

            {preflight && !blockingChecks.length && (
              <div className={styles.passChecks}>✓ Source, model, profile, budget, device, and provider window passed.</div>
            )}
          </div>

          <button
            className={styles.extendButton}
            onClick={() => void extendSelected()}
            disabled={!selectedJob || Boolean(selectedEligibility) || !preflightReady || preflightLoading || submitting}
          >
            {submitting ? "Creating extension…" : preflightLoading ? "Checking readiness…" : "Extend +7 seconds"}
          </button>

          {selectedEligibility && <p className={styles.warning}>{selectedEligibility}</p>}
          {message && <p className={styles.message}>{message}</p>}

          <p className={styles.note}>
            Preflight is read-only and does not pin R2, create a job, dispatch Inngest, or call Veo. The source is pinned only when the explicit extension request is accepted by the server.
          </p>
        </section>
      </div>
    </main>
  );
}
