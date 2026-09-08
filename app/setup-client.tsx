"use client";

import { useEffect, useMemo, useState } from "react";

type Project = { id: string; name: string };
type HealthCheck = { state: "ready" | "missing" | "error" | "unchecked"; detail: string };
type HealthResponse = { readyForPaidGeneration: boolean; checks?: Record<string, HealthCheck>; error?: string };
type PreflightCheck = { code: string; ok: boolean; message: string };
type PreflightResponse = {
  ok?: boolean;
  checks?: PreflightCheck[];
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
  error?: string;
};

export default function SetupClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "error">("idle");

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json();
      })
      .then((data) => {
        const next = Array.isArray(data.projects) ? data.projects : [];
        setProjects(next);
        setProjectId(next[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  async function runChecks() {
    setState("checking");
    setHealth(null);
    setPreflight(null);
    try {
      const healthResponse = await fetch("/api/system/health?deep=1", { cache: "no-store" });
      const nextHealth = (await healthResponse.json()) as HealthResponse;
      setHealth(nextHealth);

      if (projectId) {
        const preflightResponse = await fetch("/api/generations/preflight", {
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
        setPreflight((await preflightResponse.json()) as PreflightResponse);
      }
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const ready = Boolean(health?.readyForPaidGeneration && (!projectId || preflight?.ok));
  const healthEntries = useMemo(() => Object.entries(health?.checks ?? {}), [health]);

  return (
    <main className="settings-page">
      <section className="settings-shell setup-shell">
        <div className="settings-header">
          <div>
            <span className="eyebrow">Deployment</span>
            <h1>Live Test Readiness</h1>
            <p>Validate infrastructure, model settings, device capacity and spend limits before spending Veo credits. These checks do not create a generation job.</p>
          </div>
          <div className="settings-actions">
            <a className="ghost-button settings-link" href="/">← Workspace</a>
            <a className="ghost-button settings-link" href="/profiles">Profiles</a>
          </div>
        </div>

        <div className="setup-controls">
          <label>
            <span>Project for generation preflight</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {!projects.length ? <option value="">No project available</option> : null}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <button className="generate-button setup-check-button" onClick={() => void runChecks()} disabled={state === "checking"}>
            {state === "checking" ? "Checking…" : "Run readiness checks"}
          </button>
        </div>

        {health || preflight ? (
          <div className={`setup-banner ${ready ? "ready" : "blocked"}`}>
            <strong>{ready ? "Ready for a controlled live test" : "Not ready for a paid generation yet"}</strong>
            <small>{ready ? "Infrastructure, spend limits and current generation preflight passed." : "Resolve the failed checks below before clicking Generate."}</small>
          </div>
        ) : null}

        {state === "error" ? <div className="settings-message error">Readiness check failed unexpectedly.</div> : null}

        <div className="setup-grid">
          <section className="setup-card">
            <div className="setup-card-head"><strong>Infrastructure</strong><small>Deep checks</small></div>
            {healthEntries.length ? healthEntries.map(([name, check]) => (
              <div className="setup-check-row" key={name}>
                <span className={`readiness-dot ${check.state}`} />
                <div><strong>{name}</strong><small>{check.detail}</small></div>
              </div>
            )) : <div className="profile-empty">Run readiness checks to test PostgreSQL, Google, R2 and Inngest configuration.</div>}
          </section>

          <section className="setup-card">
            <div className="setup-card-head"><strong>Generation preflight</strong><small>Zero-credit validation</small></div>
            {preflight?.checks?.length ? preflight.checks.map((check) => (
              <div className="setup-check-row" key={check.code}>
                <span className={`readiness-dot ${check.ok ? "ready" : "error"}`} />
                <div><strong>{check.code.replaceAll("_", " ")}</strong><small>{check.message}</small></div>
              </div>
            )) : <div className="profile-empty">Select a project and run checks to validate model, limits, target device, cost and API profile.</div>}
            {preflight?.cost ? (
              <div className="setup-usage">
                Estimated request ${preflight.cost.estimatedRequestUsd.toFixed(2)} / ${preflight.cost.perRequestLimitUsd.toFixed(2)} cap · projected day ${preflight.cost.projectedDailyUsd.toFixed(2)} · projected month ${preflight.cost.projectedMonthlyUsd.toFixed(2)}
              </div>
            ) : null}
            {preflight?.usage ? (
              <div className="setup-usage">
                Jobs: today {preflight.usage.daily}/{preflight.usage.dailyLimit} · month {preflight.usage.monthly}/{preflight.usage.monthlyLimit}<br />
                Reserved spend: today ${preflight.usage.dailyReservedUsd.toFixed(2)}/${preflight.usage.dailySpendLimitUsd.toFixed(2)} · month ${preflight.usage.monthlyReservedUsd.toFixed(2)}/${preflight.usage.monthlySpendLimitUsd.toFixed(2)}
              </div>
            ) : null}
          </section>
        </div>

        <section className="setup-card setup-runbook">
          <div className="setup-card-head"><strong>Controlled first live test</strong><small>Required order</small></div>
          <ol>
            <li>Health and preflight must both pass, including the USD spend caps.</li>
            <li>Use one disposable/non-critical project and one explicit Generate click.</li>
            <li>Confirm QUEUED → SUBMITTING → PROVIDER_PENDING → CLOUD_READY.</li>
            <li>Start the desktop companion on the target PC.</li>
            <li>Confirm SHA-256 verification and LOCAL_CONFIRMED.</li>
            <li>Only after that, enable normal production use.</li>
          </ol>
        </section>
      </section>
    </main>
  );
}
