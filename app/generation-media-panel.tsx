"use client";

import { useEffect, useState } from "react";
import styles from "./generation-history.module.css";

type Replica = {
  id: string;
  device_id: string;
  device_name: string;
  device_status: string;
  relative_path: string | null;
  status: string;
  expected_hash: string | null;
  verified_hash: string | null;
  file_size_bytes: number | null;
  verified_at: string | null;
  last_seen_at: string | null;
};

type MediaOutput = {
  asset_id: string;
  filename: string;
  r2_key: string | null;
  relay_delete_after: string | null;
  relay_deleted_at: string | null;
  provider_reference_last_used_at: string | null;
  sha256: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  replicas: Replica[];
};

type MediaState = {
  jobId: string;
  jobStatus: string;
  targetDeviceId: string | null;
  outputs: MediaOutput[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function relayLabel(output: MediaOutput) {
  if (output.relay_deleted_at) return "Deleted from R2";
  if (output.r2_key) return output.relay_delete_after ? "R2 available · cleanup scheduled" : "R2 available";
  return "No R2 relay object";
}

export default function GenerationMediaPanel({ jobId }: { jobId: string }) {
  const [media, setMedia] = useState<MediaState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openingAssetId, setOpeningAssetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/generations/${encodeURIComponent(jobId)}/media`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Failed to load media locality");
        return data.media as MediaState;
      })
      .then((next) => {
        if (!cancelled) setMedia(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load media locality");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function openRelayCopy(assetId: string) {
    if (openingAssetId) return;
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    setOpeningAssetId(assetId);
    setError("");
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/download`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Relay copy is unavailable");
      if (typeof data.downloadUrl !== "string") throw new Error("No relay download URL was returned");
      if (popup) popup.location.href = data.downloadUrl;
      else window.location.href = data.downloadUrl;
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Failed to open relay copy");
    } finally {
      setOpeningAssetId(null);
    }
  }

  if (loading) return <p className={styles.empty}>Loading media locality…</p>;
  if (!media || media.outputs.length === 0) return <p className={styles.empty}>No generated media output yet.</p>;

  return (
    <div className={styles.mediaGrid}>
      {error ? <p className={styles.recordError}>{error}</p> : null}
      {media.outputs.map((output) => {
        const targetReplica = media.targetDeviceId
          ? output.replicas.find((replica) => replica.device_id === media.targetDeviceId)
          : null;
        const relayAvailable = Boolean(output.r2_key) && !output.relay_deleted_at;
        return (
          <article key={output.asset_id} className={styles.mediaCard}>
            <div className={styles.recordTitle}>
              <strong>{output.filename}</strong>
              <span>{relayLabel(output)}</span>
            </div>

            <dl>
              <div><dt>Relay cleanup</dt><dd>{output.relay_deleted_at ? formatDate(output.relay_deleted_at) : output.relay_delete_after ? formatDate(output.relay_delete_after) : "Not scheduled"}</dd></div>
              <div><dt>Extension reference</dt><dd>{formatDate(output.provider_reference_last_used_at)}</dd></div>
              <div><dt>Target device</dt><dd>{targetReplica ? `${targetReplica.device_name} · ${targetReplica.status}` : media.targetDeviceId ? "Not present yet" : "None selected"}</dd></div>
            </dl>

            {relayAvailable ? (
              <div className={styles.mediaActions}>
                <button onClick={() => void openRelayCopy(output.asset_id)} disabled={openingAssetId !== null}>
                  {openingAssetId === output.asset_id ? "Opening…" : "Open R2 copy"}
                </button>
                <span>Short-lived signed link · no R2 credentials exposed</span>
              </div>
            ) : null}

            <div className={styles.replicaList}>
              {output.replicas.length === 0 ? <span>No device replicas reported.</span> : null}
              {output.replicas.map((replica) => {
                const verified = replica.status === "verified" && replica.verified_hash && replica.verified_hash === output.sha256;
                return (
                  <div key={replica.id} className={styles.replicaRow}>
                    <div>
                      <strong>{replica.device_name}</strong>
                      <span>{replica.relative_path || "Path not reported"}</span>
                    </div>
                    <span className={verified ? styles.replicaVerified : styles.replicaPending}>
                      {verified ? "SHA-256 VERIFIED" : replica.status.replaceAll("_", " ").toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
