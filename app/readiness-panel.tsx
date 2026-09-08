"use client";

import { useState } from "react";

type HealthCheck = { state: "ready" | "missing" | "error" | "unchecked"; detail: string };
type HealthResponse = {
  readyForPaidGeneration: boolean;
  checks?: Record<string, HealthCheck>;
  error?: string;
};

type PreflightResponse = {
  ok?: boolean;
  checks?: Array<{ code: string; ok: boolean; message: string }>;
  usage?: { daily: number; dailyLimit: number; monthly: number; monthlyLimit: number };
  error?: string;
};

export default function ReadinessPanel(props: {
  enabled: boolean;
  projectId: string;
  apiProfileId?: string | null;
  modelId: string;
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
}) {
  const [state, setState] = useState<"idle" | "checking" | "ready" | "blocked" | "error">("idle");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);

  async function checkReadiness() {
    if (!props.enabled || !props.projectId || state === "checking") return;
    setState("checking");
    setHealth(null);
    setPreflight(null);

    try {
      const [healthResponse, preflightResponse] = await Promise.all([
        fetch("/api/system/health?deep=1", { cache: "no-store" }),
        fetch("/api/generations/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: props.projectId,
            requestedApiProfileId: props.apiProfileId ?? null,
            modelId: props.modelId,
            aspectRatio: props.aspectRatio,
            durationSeconds: props.durationSeconds,
            resolution: props.resolution,
          }),
        }),
      ]);

      const nextHealth = (await healthResponse.json()) as HealthResponse;
      const nextPreflight = (await preflightResponse.json()) as PreflightResponse;
      setHealth(nextHealth);
      setPreflight(nextPreflight);

      if (nextHealth.readyForPaidGeneration && nextPreflight.ok) setState("ready");
      else setState("blocked");
    } catch {
      setState("error");
    }
  }

  const healthChecks = health?.checks ? Object.entries(health.checks) : [];
  const preflightChecks = preflight?.checks ?? [];

  return (
    <div className="readiness-card">
      <div className="readiness-head">
        <div>
          <strong>Live test readiness</strong>
          <small>No Veo credits are spent by this check.</small>
        </div>
        <button className="tiny-button" onClick={() => void checkReadiness()} disabled={!props.enabled || state === "checking"}>
          {state === "checking" ? "Checking…" : "Check readiness"}
        </button>
      </div>

      {state !== "idle" && (
        <div className={`readiness-summary ${state}`}>
          {state === "ready" ? "Ready for a controlled paid generation test." : state === "error" ? "Readiness check failed." : "Not ready for a paid generation yet."}
        </div>
      )}

      {healthChecks.length > 0 && (
        <div className="readiness-list">
          {healthChecks.map(([name, check]) => (
            <div className="readiness-row" key={name}>
              <span className={`readiness-dot ${check.state}`} />
              <div><strong>{name}</strong><small>{check.detail}</small></div>
            </div>
          ))}
        </div>
      )}

      {preflightChecks.length > 0 && (
        <div className="readiness-list preflight-list">
          {preflightChecks.map((check) => (
            <div className="readiness-row" key={check.code}>
              <span className={`readiness-dot ${check.ok ? "ready" : "error"}`} />
              <div><strong>{check.code.replaceAll("_", " ")}</strong><small>{check.message}</small></div>
            </div>
          ))}
        </div>
      )}

      {preflight?.usage && (
        <small className="readiness-usage">
          Usage: {preflight.usage.daily}/{preflight.usage.dailyLimit} today · {preflight.usage.monthly}/{preflight.usage.monthlyLimit} this month
        </small>
      )}
    </div>
  );
}
