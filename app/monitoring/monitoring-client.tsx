"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./monitoring.module.css";

type Alert = {
  severity: "critical" | "warning" | "info";
  code: string;
  title: string;
  detail: string;
};

type Snapshot = {
  generatedAt: string;
  alerts: Alert[];
  generations: {
    failedAmbiguous24h: number;
    failedFinal24h: number;
    failedRetryable24h: number;
    providerPending: number;
    cloudReady24h: number;
  };
  spend: {
    dailyReservedUsd: number;
    monthlyReservedUsd: number;
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    dailyPercent: number;
    monthlyPercent: number;
    dailyGenerationCount: number;
    monthlyGenerationCount: number;
    dailyGenerationLimit: number;
    monthlyGenerationLimit: number;
  };
  devices: Array<{
    id: string;
    name: string;
    status: string;
    secondsSinceSeen: number | null;
    freeDiskBytes: number | null;
    stale: boolean;
    lowDisk: boolean;
  }>;
  recentFailures: Array<{
    jobId: string;
    projectName: string;
    modelId: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: string;
  }>;
};

function bytes(value: number | null) {
  if (value === null) return "Unknown";
  const gib = value / 1024 / 1024 / 1024;
  return `${gib.toFixed(gib >= 100 ? 0 : 1)} GiB`;
}

function age(seconds: number | null) {
  if (seconds === null) return "Never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function MonitoringClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/system/monitoring", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Monitoring request failed");
      setSnapshot(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Monitoring request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Operations</p>
          <h1>Production monitoring</h1>
          <p>Paid-generation safety, provider failures, spend utilization, and target-device health.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {!snapshot && !error ? <div className={styles.panel}>Loading current workspace health…</div> : null}

      {snapshot ? (
        <>
          <section className={styles.metrics} aria-label="Generation metrics">
            <article className={styles.metric}>
              <span>Ambiguous paid / 24h</span>
              <strong>{snapshot.generations.failedAmbiguous24h}</strong>
            </article>
            <article className={styles.metric}>
              <span>Provider failures / 24h</span>
              <strong>{snapshot.generations.failedFinal24h + snapshot.generations.failedRetryable24h}</strong>
            </article>
            <article className={styles.metric}>
              <span>Provider pending</span>
              <strong>{snapshot.generations.providerPending}</strong>
            </article>
            <article className={styles.metric}>
              <span>Cloud/local ready / 24h</span>
              <strong>{snapshot.generations.cloudReady24h}</strong>
            </article>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div>
                <p className={styles.eyebrow}>Alerts</p>
                <h2>{snapshot.alerts.length ? `${snapshot.alerts.length} active` : "No active alerts"}</h2>
              </div>
              <small>Updated {new Date(snapshot.generatedAt).toLocaleString()}</small>
            </div>
            <div className={styles.alerts}>
              {snapshot.alerts.length ? snapshot.alerts.map((alert, index) => (
                <article key={`${alert.code}-${index}`} className={`${styles.alert} ${styles[alert.severity]}`}>
                  <div>
                    <strong>{alert.title}</strong>
                    <span>{alert.code}</span>
                  </div>
                  <p>{alert.detail}</p>
                </article>
              )) : (
                <p className={styles.good}>No ambiguous paid submissions, provider-failure warnings, low-disk warnings, or spend-threshold alerts are active.</p>
              )}
            </div>
          </section>

          <section className={styles.twoColumn}>
            <article className={styles.panel}>
              <p className={styles.eyebrow}>Spend & caps</p>
              <h2>Reserved usage</h2>
              <div className={styles.usageRow}>
                <span>Today</span>
                <strong>${snapshot.spend.dailyReservedUsd.toFixed(2)} / ${snapshot.spend.dailyLimitUsd.toFixed(2)}</strong>
                <progress max="100" value={Math.min(snapshot.spend.dailyPercent, 100)} />
                <small>{snapshot.spend.dailyPercent.toFixed(1)}% · {snapshot.spend.dailyGenerationCount}/{snapshot.spend.dailyGenerationLimit} jobs</small>
              </div>
              <div className={styles.usageRow}>
                <span>This month</span>
                <strong>${snapshot.spend.monthlyReservedUsd.toFixed(2)} / ${snapshot.spend.monthlyLimitUsd.toFixed(2)}</strong>
                <progress max="100" value={Math.min(snapshot.spend.monthlyPercent, 100)} />
                <small>{snapshot.spend.monthlyPercent.toFixed(1)}% · {snapshot.spend.monthlyGenerationCount}/{snapshot.spend.monthlyGenerationLimit} jobs</small>
              </div>
            </article>

            <article className={styles.panel}>
              <p className={styles.eyebrow}>Desktop companions</p>
              <h2>Target devices</h2>
              <div className={styles.deviceList}>
                {snapshot.devices.length ? snapshot.devices.map((device) => (
                  <div key={device.id} className={styles.device}>
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.lowDisk ? "Low disk" : device.stale ? "Stale/offline" : device.status}</span>
                    </div>
                    <small>{bytes(device.freeDiskBytes)} free · {age(device.secondsSinceSeen)}</small>
                  </div>
                )) : <p>No desktop companion has registered yet.</p>}
              </div>
            </article>
          </section>

          <section className={styles.panel}>
            <p className={styles.eyebrow}>Failure review</p>
            <h2>Recent failed jobs</h2>
            {snapshot.recentFailures.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Project</th>
                      <th>Model</th>
                      <th>Error</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.recentFailures.map((failure) => (
                      <tr key={failure.jobId}>
                        <td><a href="/generations">{failure.status}</a></td>
                        <td>{failure.projectName}</td>
                        <td>{failure.modelId}</td>
                        <td title={failure.errorMessage ?? ""}>{failure.errorCode ?? failure.errorMessage ?? "—"}</td>
                        <td>{new Date(failure.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className={styles.good}>No recent failed generation jobs.</p>}
          </section>
        </>
      ) : null}
    </main>
  );
}
