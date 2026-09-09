"use client";

import { useEffect, useState } from "react";
import styles from "./project-backup.module.css";

type Project = {
  id: string;
  name: string;
  description?: string | null;
  scene_count?: number;
};

export default function ProjectBackupClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Failed to load projects");
        return Array.isArray(data.projects) ? data.projects : [];
      })
      .then(setProjects)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }, []);

  async function downloadBackup(project: Project) {
    if (downloading) return;
    setDownloading(project.id);
    setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/backup`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Backup export failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] ?? `${project.name}.flow-project.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup export failed");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Credential-free snapshots</p>
        <h1>Project Backups</h1>
        <p>
          Export portable JSON snapshots of persistent project state and history. Provider credentials,
          encrypted API keys, login secrets, database credentials, relay credentials, Inngest keys, and companion tokens are excluded.
        </p>
      </header>

      <section className={styles.notice}>
        <strong>Backup scope</strong>
        <span>Projects, scenes, prompt versions, asset metadata, device replica metadata, generation jobs/attempts/outputs, Agent history, and research citations.</span>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <p className={styles.empty}>Loading projects…</p> : null}
      {!loading && projects.length === 0 ? <p className={styles.empty}>No projects to back up yet.</p> : null}

      <section className={styles.grid}>
        {projects.map((project) => (
          <article key={project.id} className={styles.card}>
            <div>
              <h2>{project.name}</h2>
              <p>{project.description || "No project description"}</p>
            </div>
            <dl>
              <div><dt>Scenes</dt><dd>{project.scene_count ?? 0}</dd></div>
              <div><dt>Project ID</dt><dd><code>{project.id}</code></dd></div>
            </dl>
            <button onClick={() => void downloadBackup(project)} disabled={downloading !== null}>
              {downloading === project.id ? "Preparing backup…" : "Download JSON backup"}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
