"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./setup.module.css";

type Project = { id: string; name: string };
type HealthState = "ready" | "missing" | "error" | "unchecked";
type SystemHealth = {
  readyForPaidGeneration: boolean;
  readyForPublicDeployment: boolean;
  checks: Record<string, { state: HealthState; detail: string }>;
};
type Preflight = {
  ok: boolean;
  checks: Array<{ code: string; ok: boolean; message: string }>;
  usage?: {
    daily: number;
    dailyLimit: number;
    monthly: number;
    monthlyLimit: number;
    dailyReservedUsd: number;
    dailySpendLimitUsd: number;
    monthlyReservedUsd: number;
    monthlySpendLimitUsd: number;
  };
  cost?: {
    estimatedRequestUsd: number;
    perRequestLimitUsd: number;
    projectedDailyUsd: number;
    projectedMonthlyUsd: number;
    pricingVersion: string;
  } | null;
};

const checkLabels: Record<string, string> = {
  ownerAuth: "Owner Auth",
  database: "PostgreSQL",
  google: "Google profile",
  r2: "R2 relay",
  inngest: "Inngest",
  credentialEncryption: "Credential encryption",
  companion: "Desktop companion",
};

export default function SetupDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [error, setError] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Database/project API is not available yet.");
        return response.json();
      })
      .then((data) => {
        const next = Array.isArray(data.projects) ? data.projects : [];
        setProjects(next);
        setProjectId(next[0]?.id ?? "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load projects."));
  }, []);

  async function runHealth() {
    setLoadingHealth(true);
    setError("");
    try {
      const response = await fetch("/api/system/health?deep=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Health check failed");
      setHealth(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Health check failed");
    } finally {
      setLoadingHealth(false);
    }
  }

  async function runPreflight() {
    if (!projectId) return;
    setLoadingPreflight(true);
    setError("");
    try {
      const response = await fetch("/api/generations/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          modelId: "veo-3.1-generate-preview",
          aspectRatio: "9:16",
          durationSeconds: 8,
          resolution: "1080p",
        }),
      });
      const data = await response.json();
      setPreflight(data);
      if (!response.ok && !data.checks) throw new Error(data.error ?? "Preflight failed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preflight failed");
    } finally {
      setLoadingPreflight(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span>Deployment readiness</span>
        <h1>Live-test setup</h1>
        <p>Check infrastructure and run a zero-credit generation preflight before allowing any paid Veo request.</p>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <div><small>Step 1</small><h2>Infrastructure</h2></div>
            <button onClick={() => void runHealth()} disabled={loadingHealth}>
              {loadingHealth ? "Checking…" : "Run deep health"}
            </button>
          </div>

          {health ? (
            <>
              <div className={styles.readinessGrid}>
                <div className={health.readyForPaidGeneration ? styles.ready : styles.blocked}>
                  <strong>{health.readyForPaidGeneration ? "Paid generation ready" : "Paid generation blocked"}</strong>
                  <span>Database + Google + R2 + Inngest</span>
                </div>
                <div className={health.readyForPublicDeployment ? styles.ready : styles.blocked}>
                  <strong>{health.readyForPublicDeployment ? "Public deployment ready" : "Public deployment blocked"}</strong>
                  <span>Paid path + Owner Auth</span>
                </div>
              </div>
              <div className={styles.checks}>
                {Object.entries(health.checks).map(([key, check]) => (
                  <div className={styles.checkRow} key={key}>
                    <span className={`${styles.dot} ${styles[check.state]}`} />
                    <div><strong>{checkLabels[key] ?? key}</strong><small>{check.detail}</small></div>
                    <em>{check.state}</em>
                  </div>
                ))}
              </div>
            </>
          ) : <p className={styles.placeholder}>Run the deep check to test PostgreSQL/schema, the active Google profile, R2, Inngest configuration, owner auth, and optional local-delivery protections.</p>}
        </article>

        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <div><small>Step 2</small><h2>Zero-credit preflight</h2></div>
            <button onClick={() => void runPreflight()} disabled={!projectId || loadingPreflight}>
              {loadingPreflight ? "Checking…" : "Run preflight"}
            </button>
          </div>

          <label className={styles.field}>
            <span>Test project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {!projects.length && <option value="">No projects yet</option>}
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>

          <div className={styles.testSpec}>
            <span>Model <strong>Veo 3.1</strong></span>
            <span>Format <strong>9:16</strong></span>
            <span>Duration <strong>8 sec</strong></span>
            <span>Resolution <strong>1080p</strong></span>
          </div>

          {selectedProject && <p className={styles.caption}>Preflight target: {selectedProject.name}. It does not create a job and does not call Veo.</p>}

          {preflight ? (
            <div className={styles.preflight}>
              <div className={preflight.ok ? styles.ready : styles.blocked}>
                <strong>{preflight.ok ? "Preflight passed" : "Preflight blocked"}</strong>
                {preflight.cost && <span>Estimated request ${preflight.cost.estimatedRequestUsd.toFixed(2)}</span>}
              </div>

              {preflight.cost && preflight.usage && (
                <div className={styles.costGrid}>
                  <span>Request <strong>${preflight.cost.estimatedRequestUsd.toFixed(2)} / ${preflight.cost.perRequestLimitUsd.toFixed(2)}</strong></span>
                  <span>Projected today <strong>${preflight.cost.projectedDailyUsd.toFixed(2)} / ${preflight.usage.dailySpendLimitUsd.toFixed(2)}</strong></span>
                  <span>Projected month <strong>${preflight.cost.projectedMonthlyUsd.toFixed(2)} / ${preflight.usage.monthlySpendLimitUsd.toFixed(2)}</strong></span>
                  <span>Pricing <strong>{preflight.cost.pricingVersion}</strong></span>
                </div>
              )}

              <div className={styles.checks}>
                {preflight.checks.map((check) => (
                  <div className={styles.checkRow} key={check.code}>
                    <span className={`${styles.dot} ${check.ok ? styles.readyDot : styles.error}`} />
                    <div><strong>{check.code.replaceAll("_", " ")}</strong><small>{check.message}</small></div>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className={styles.placeholder}>This runs the same model, usage, spend, device, and profile checks used before real job creation, without inserting a generation.</p>}
        </article>
      </section>
    </main>
  );
}
