"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./generation-history.module.css";

type GenerationListItem = {
  id: string;
  generation_request_id: string;
  project_id: string;
  scene_id?: string | null;
  scene_title?: string | null;
  requested_api_profile_id?: string | null;
  target_device_id?: string | null;
  model_id: string;
  status: string;
  estimated_cost_usd?: number | string | null;
  pricing_version?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Attempt = {
  id: string;
  api_profile_id?: string | null;
  provider: string;
  model_id: string;
  provider_operation_id?: string | null;
  status: string;
  started_at?: string;
  completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

type Output = {
  id: string;
  asset_id: string;
  filename: string;
  relative_path?: string | null;
  r2_key?: string | null;
  sha256?: string | null;
  file_size_bytes?: number | null;
};

type Input = {
  asset_id: string;
  role: string;
  sort_order: number;
  filename: string;
  mime_type?: string | null;
  r2_key?: string | null;
  sha256?: string | null;
  file_size_bytes?: number | null;
};

type GenerationDetail = GenerationListItem & {
  project_name?: string;
  prompt_snapshot?: string;
  aspect_ratio_snapshot?: string;
  duration_seconds_snapshot?: number | null;
  resolution_snapshot?: string | null;
  attempts: Attempt[];
  outputs: Output[];
  inputs: Input[];
};

type Profile = { id: string; name: string; enabled: boolean };

const activeStatuses = new Set([
  "queued",
  "submitting",
  "provider_pending",
  "downloading_from_provider",
  "uploading_relay",
]);

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "—";
}

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let number = value;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index += 1;
  }
  return `${number.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

export default function GenerationHistoryClient() {
  const [jobs, setJobs] = useState<GenerationListItem[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [detail, setDetail] = useState<GenerationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionState, setActionState] = useState<"idle" | "retrying">("idle");
  const [filter, setFilter] = useState("all");

  const profileNames = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.name])),
    [profiles],
  );

  const visibleJobs = useMemo(
    () => (filter === "all" ? jobs : jobs.filter((job) => job.status === filter)),
    [jobs, filter],
  );

  async function refreshJobs(preserveSelection = true) {
    setError("");
    try {
      const [jobsResponse, profilesResponse] = await Promise.all([
        fetch("/api/generations", { cache: "no-store" }),
        fetch("/api/profiles", { cache: "no-store" }),
      ]);
      const jobsData = await jobsResponse.json().catch(() => ({}));
      const profilesData = profilesResponse.ok ? await profilesResponse.json().catch(() => ({})) : {};
      if (!jobsResponse.ok) throw new Error(jobsData.error ?? "Failed to load generation history");

      const nextJobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
      setJobs(nextJobs);
      setProfiles(Array.isArray(profilesData.profiles) ? profilesData.profiles : []);
      if (!preserveSelection || !nextJobs.some((job: GenerationListItem) => job.id === selectedJobId)) {
        setSelectedJobId(nextJobs[0]?.id ?? "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load generation history");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(jobId: string) {
    if (!jobId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Failed to load generation detail");
      setDetail(data.job ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load generation detail");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void refreshJobs(false);
  }, []);

  useEffect(() => {
    void loadDetail(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!jobs.some((job) => activeStatuses.has(job.status))) return;
    const timer = window.setInterval(() => void refreshJobs(true), 5000);
    return () => window.clearInterval(timer);
  }, [jobs, selectedJobId]);

  async function retrySelected() {
    if (!detail || actionState !== "idle") return;
    setActionState("retrying");
    setError("");
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(detail.id)}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Retry failed");
      await refreshJobs(true);
      await loadDetail(detail.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Retry failed");
    } finally {
      setActionState("idle");
    }
  }

  const retryable = detail?.status === "failed_retryable";
  const ambiguous = detail?.status === "failed_ambiguous";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Persistent execution ledger</p>
          <h1>Generation History</h1>
          <p>Jobs, attempts, frozen inputs, spend, provider operation IDs, and outputs remain visible regardless of which Google profile is active now.</p>
        </div>
        <button className={styles.refreshButton} onClick={() => void refreshJobs(true)} disabled={loading}>
          Refresh
        </button>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.toolbar}>
        <label>
          Status
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="queued">Queued</option>
            <option value="provider_pending">Provider pending</option>
            <option value="cloud_ready">Cloud ready</option>
            <option value="local_confirmed">Local confirmed</option>
            <option value="failed_retryable">Failed retryable</option>
            <option value="failed_ambiguous">Failed ambiguous</option>
            <option value="failed_final">Failed final</option>
          </select>
        </label>
        <span>{visibleJobs.length} job{visibleJobs.length === 1 ? "" : "s"}</span>
      </section>

      <div className={styles.layout}>
        <section className={styles.listPanel}>
          {loading ? <p className={styles.empty}>Loading history…</p> : null}
          {!loading && visibleJobs.length === 0 ? <p className={styles.empty}>No generation jobs match this filter.</p> : null}
          {visibleJobs.map((job) => (
            <button
              key={job.id}
              className={`${styles.jobCard} ${selectedJobId === job.id ? styles.selected : ""}`}
              onClick={() => setSelectedJobId(job.id)}
            >
              <div className={styles.jobTopline}>
                <strong>{job.scene_title || "Untitled generation"}</strong>
                <span className={`${styles.status} ${styles[job.status] ?? ""}`}>{statusLabel(job.status)}</span>
              </div>
              <span>{job.model_id}</span>
              <div className={styles.jobMeta}>
                <span>{formatMoney(job.estimated_cost_usd)}</span>
                <span>{formatDate(job.created_at)}</span>
              </div>
            </button>
          ))}
        </section>

        <section className={styles.detailPanel}>
          {!selectedJobId ? <p className={styles.empty}>Select a generation to inspect it.</p> : null}
          {detailLoading ? <p className={styles.empty}>Loading generation detail…</p> : null}
          {detail && !detailLoading ? (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <p className={styles.eyebrow}>Job {detail.id}</p>
                  <h2>{detail.scene_title || detail.project_name || "Generation"}</h2>
                  <span className={`${styles.status} ${styles[detail.status] ?? ""}`}>{statusLabel(detail.status)}</span>
                </div>
                <div className={styles.actions}>
                  {retryable ? (
                    <button onClick={() => void retrySelected()} disabled={actionState !== "idle"}>
                      {actionState === "retrying" ? "Retrying…" : "Retry safely"}
                    </button>
                  ) : null}
                  <a href="/extensions">Open Extensions</a>
                </div>
              </div>

              {ambiguous ? (
                <div className={styles.warning}>
                  Provider submission is ambiguous. This logical job must not automatically call Veo again because it may already be billable.
                </div>
              ) : null}

              <div className={styles.metrics}>
                <div><span>Estimated cost</span><strong>{formatMoney(detail.estimated_cost_usd)}</strong></div>
                <div><span>Profile</span><strong>{detail.requested_api_profile_id ? profileNames.get(detail.requested_api_profile_id) || detail.requested_api_profile_id : "Default"}</strong></div>
                <div><span>Resolution</span><strong>{detail.resolution_snapshot || "—"}</strong></div>
                <div><span>Duration</span><strong>{detail.duration_seconds_snapshot ? `${detail.duration_seconds_snapshot}s` : "—"}</strong></div>
                <div><span>Aspect</span><strong>{detail.aspect_ratio_snapshot || "—"}</strong></div>
                <div><span>Pricing</span><strong>{detail.pricing_version || "—"}</strong></div>
              </div>

              <section className={styles.section}>
                <h3>Frozen prompt</h3>
                <pre>{detail.prompt_snapshot || "No prompt snapshot recorded."}</pre>
              </section>

              <section className={styles.section}>
                <h3>Attempts</h3>
                {detail.attempts.length === 0 ? <p className={styles.empty}>No provider attempt has started.</p> : null}
                {detail.attempts.map((attempt) => (
                  <article key={attempt.id} className={styles.record}>
                    <div className={styles.recordTitle}>
                      <strong>{statusLabel(attempt.status)}</strong>
                      <span>{profileNames.get(attempt.api_profile_id || "") || attempt.api_profile_id || "Default profile"}</span>
                    </div>
                    <dl>
                      <div><dt>Operation</dt><dd>{attempt.provider_operation_id || "Not assigned"}</dd></div>
                      <div><dt>Started</dt><dd>{formatDate(attempt.started_at)}</dd></div>
                      <div><dt>Completed</dt><dd>{formatDate(attempt.completed_at)}</dd></div>
                      {attempt.error_code ? <div><dt>Error code</dt><dd>{attempt.error_code}</dd></div> : null}
                    </dl>
                    {attempt.error_message ? <p className={styles.recordError}>{attempt.error_message}</p> : null}
                  </article>
                ))}
              </section>

              <section className={styles.section}>
                <h3>Frozen input assets</h3>
                {detail.inputs.length === 0 ? <p className={styles.empty}>Text-only generation.</p> : null}
                {detail.inputs.map((input) => (
                  <article key={`${input.role}-${input.sort_order}-${input.asset_id}`} className={styles.assetRow}>
                    <div>
                      <strong>{input.filename}</strong>
                      <span>{input.role.replaceAll("_", " ")} · {input.mime_type || "unknown type"}</span>
                    </div>
                    <span>{formatBytes(input.file_size_bytes)}</span>
                  </article>
                ))}
              </section>

              <section className={styles.section}>
                <h3>Outputs</h3>
                {detail.outputs.length === 0 ? <p className={styles.empty}>No durable output recorded yet.</p> : null}
                {detail.outputs.map((output) => (
                  <article key={output.asset_id} className={styles.assetRow}>
                    <div>
                      <strong>{output.filename}</strong>
                      <span>{output.relative_path || "Cloud relay / local delivery pending"}</span>
                    </div>
                    <div className={styles.outputMeta}>
                      <span>{formatBytes(output.file_size_bytes)}</span>
                      <code>{output.sha256 ? `${output.sha256.slice(0, 12)}…` : "no hash"}</code>
                    </div>
                  </article>
                ))}
              </section>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
