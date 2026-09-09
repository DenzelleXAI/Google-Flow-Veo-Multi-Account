"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./asset-library.module.css";

type Project = { id: string; name: string };
type Asset = {
  id: string;
  project_id: string;
  project_name: string;
  type: string;
  filename: string;
  mime_type: string | null;
  relative_path: string | null;
  r2_key: string | null;
  relay_delete_after: string | null;
  relay_deleted_at: string | null;
  provider_reference_last_used_at: string | null;
  sha256: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  replica_count: number;
  verified_replica_count: number;
  created_at: string;
};

function formatBytes(value: number | null) {
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

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function friendlyType(value: string) {
  return value.replaceAll("_", " ");
}

export default function AssetLibraryClient() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingAssetId, setOpeningAssetId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const assetUrl = projectId === "all" ? "/api/assets" : `/api/assets?projectId=${encodeURIComponent(projectId)}`;
      const [assetResponse, projectResponse] = await Promise.all([
        fetch(assetUrl, { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ]);
      const assetData = await assetResponse.json().catch(() => ({}));
      const projectData = projectResponse.ok ? await projectResponse.json().catch(() => ({})) : {};
      if (!assetResponse.ok) throw new Error(assetData.error ?? "Failed to load assets");
      setAssets(Array.isArray(assetData.assets) ? assetData.assets : []);
      setProjects(Array.isArray(projectData.projects) ? projectData.projects : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load asset library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const assetTypes = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.type))).sort(),
    [assets],
  );

  const visibleAssets = useMemo(() => {
    const search = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) return false;
      if (!search) return true;
      return [asset.filename, asset.project_name, asset.type, asset.mime_type ?? ""]
        .some((value) => value.toLowerCase().includes(search));
    });
  }, [assets, query, typeFilter]);

  async function openRelayCopy(asset: Asset) {
    if (openingAssetId) return;
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    setOpeningAssetId(asset.id);
    setError("");
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}/download`, { cache: "no-store" });
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Persistent media catalog</p>
          <h1>Asset Library</h1>
          <p>Uploaded references and generated media remain attached to the project database even when provider profiles change or a local replica is temporarily missing.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.filters}>
        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label>
          Type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {assetTypes.map((type) => <option key={type} value={type}>{friendlyType(type)}</option>)}
          </select>
        </label>
        <label className={styles.search}>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="filename, project, type…" />
        </label>
        <span>{visibleAssets.length} asset{visibleAssets.length === 1 ? "" : "s"}</span>
      </section>

      {loading ? <p className={styles.empty}>Loading assets…</p> : null}
      {!loading && visibleAssets.length === 0 ? <p className={styles.empty}>No assets match these filters.</p> : null}

      <section className={styles.grid}>
        {visibleAssets.map((asset) => {
          const relayAvailable = Boolean(asset.r2_key) && !asset.relay_deleted_at;
          const fullyVerified = asset.verified_replica_count > 0;
          return (
            <article key={asset.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.type}>{friendlyType(asset.type)}</span>
                <span className={fullyVerified ? styles.verified : styles.pending}>
                  {fullyVerified ? `${asset.verified_replica_count} VERIFIED` : "NO VERIFIED REPLICA"}
                </span>
              </div>

              <div>
                <h2>{asset.filename}</h2>
                <p>{asset.project_name}</p>
              </div>

              <dl>
                <div><dt>MIME</dt><dd>{asset.mime_type || "—"}</dd></div>
                <div><dt>Size</dt><dd>{formatBytes(asset.file_size_bytes)}</dd></div>
                <div><dt>Dimensions</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "—"}</dd></div>
                <div><dt>Duration</dt><dd>{asset.duration_seconds ? `${asset.duration_seconds}s` : "—"}</dd></div>
                <div><dt>Replicas</dt><dd>{asset.verified_replica_count}/{asset.replica_count} verified</dd></div>
                <div><dt>Created</dt><dd>{formatDate(asset.created_at)}</dd></div>
              </dl>

              <div className={styles.relay}>
                <strong>{asset.relay_deleted_at ? "R2 relay deleted" : relayAvailable ? "R2 relay available" : "No R2 relay"}</strong>
                <span>
                  {asset.relay_deleted_at
                    ? `Deleted ${formatDate(asset.relay_deleted_at)}`
                    : asset.relay_delete_after
                      ? `Cleanup ${formatDate(asset.relay_delete_after)}`
                      : asset.provider_reference_last_used_at
                        ? `Provider reference ${formatDate(asset.provider_reference_last_used_at)}`
                        : "No cleanup scheduled"}
                </span>
              </div>

              <div className={styles.hash}>
                <span>SHA-256</span>
                <code>{asset.sha256 || "not recorded"}</code>
              </div>

              {relayAvailable ? (
                <button className={styles.openButton} onClick={() => void openRelayCopy(asset)} disabled={openingAssetId !== null}>
                  {openingAssetId === asset.id ? "Opening…" : "Open relay copy"}
                </button>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
