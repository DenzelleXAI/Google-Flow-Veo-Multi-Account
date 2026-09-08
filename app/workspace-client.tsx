"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Project = {
  id: string;
  name: string;
  description?: string | null;
  scene_count?: number;
};

type Scene = {
  id: string;
  project_id: string;
  title: string;
  prompt?: string | null;
  prompt_version?: number | null;
  aspect_ratio?: string;
  duration_seconds?: number | null;
  resolution?: string | null;
};

type GenerationJob = {
  id: string;
  status: string;
  model_id: string;
  scene_title?: string | null;
  outputs?: Array<{ asset_id: string; filename: string; r2_key?: string | null }>;
};

const demoProjects: Project[] = [
  { id: "demo-1", name: "Scar Day Cream", scene_count: 2 },
  { id: "demo-2", name: "Hair Growth Tonic", scene_count: 0 },
  { id: "demo-3", name: "Age Defying Gel", scene_count: 0 },
];

const demoScene: Scene = {
  id: "demo-scene",
  project_id: "demo-1",
  title: "Approach 1 · Clip 2",
  prompt:
    "Same Filipina woman from Clip 1, now standing outside a modest home while holding the exact Scar Day Cream product. Natural handheld testimonial framing, believable skin texture, warm daylight, realistic neighborhood background.",
  prompt_version: 3,
  aspect_ratio: "9:16",
  duration_seconds: 8,
  resolution: "1080p",
};

const activeGenerationStatuses = new Set([
  "queued",
  "submitting",
  "provider_pending",
  "downloading_from_provider",
  "uploading_relay",
]);

export default function WorkspaceClient() {
  const [projects, setProjects] = useState<Project[]>(demoProjects);
  const [selectedProjectId, setSelectedProjectId] = useState(demoProjects[0].id);
  const [scenes, setScenes] = useState<Scene[]>([demoScene]);
  const [selectedSceneId, setSelectedSceneId] = useState(demoScene.id);
  const [prompt, setPrompt] = useState(demoScene.prompt ?? "");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "demo" | "error">("demo");
  const [backendMode, setBackendMode] = useState<"database" | "demo">("demo");
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [generationState, setGenerationState] = useState<"idle" | "submitting" | "queued" | "error">("idle");
  const pendingGenerationRequestId = useRef<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0],
    [scenes, selectedSceneId],
  );

  async function refreshGenerationJobs(projectId = selectedProjectId) {
    if (backendMode !== "database" || !projectId) return;
    try {
      const response = await fetch(`/api/generations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = response.ok ? await response.json() : { jobs: [] };
      setGenerationJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      // Keep the previous list during transient polling failures.
    }
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json();
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data.projects)) return;
        setBackendMode("database");
        setSaveState("saved");
        setProjects(data.projects);
        if (data.projects[0]) setSelectedProjectId(data.projects[0].id);
      })
      .catch(() => {
        if (!cancelled) {
          setBackendMode("demo");
          setSaveState("demo");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (backendMode !== "database" || !selectedProjectId) return;

    fetch(`/api/projects/${selectedProjectId}/scenes`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load scenes");
        return response.json();
      })
      .then((data) => {
        const nextScenes = Array.isArray(data.scenes) ? data.scenes : [];
        setScenes(nextScenes);
        if (nextScenes[0]) {
          setSelectedSceneId(nextScenes[0].id);
          setPrompt(nextScenes[0].prompt ?? "");
        } else {
          setSelectedSceneId("");
          setPrompt("");
        }
      })
      .catch(() => setSaveState("error"));

    void refreshGenerationJobs(selectedProjectId);
  }, [backendMode, selectedProjectId]);

  useEffect(() => {
    if (backendMode !== "database" || !generationJobs.some((job) => activeGenerationStatuses.has(job.status))) return;
    const timer = window.setInterval(() => {
      void refreshGenerationJobs();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [backendMode, selectedProjectId, generationJobs]);

  useEffect(() => {
    if (backendMode !== "database" || !selectedSceneId || !prompt.trim()) return;

    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/scenes/${selectedSceneId}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: prompt }),
        });

        if (!response.ok) throw new Error("Save failed");
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [backendMode, selectedSceneId, prompt]);

  async function createNewProject() {
    if (backendMode !== "database") return;
    const name = window.prompt("Project name");
    if (!name?.trim()) return;

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    if (!response.ok) return;
    const data = await response.json();
    setProjects((current) => [data.project, ...current]);
    setSelectedProjectId(data.project.id);
  }

  async function createNewScene() {
    if (backendMode !== "database" || !selectedProjectId) return;
    const title = window.prompt("Scene title", "Approach 1 · Clip 1");
    if (!title?.trim()) return;

    const response = await fetch(`/api/projects/${selectedProjectId}/scenes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });

    if (!response.ok) return;
    const data = await response.json();
    setScenes((current) => [...current, data.scene]);
    setSelectedSceneId(data.scene.id);
    setPrompt("");
  }

  async function createGeneration() {
    if (
      backendMode !== "database" ||
      !selectedProjectId ||
      !selectedSceneId ||
      !selectedScene ||
      !prompt.trim() ||
      generationState === "submitting"
    ) return;

    if (!pendingGenerationRequestId.current) {
      pendingGenerationRequestId.current = crypto.randomUUID();
    }

    setGenerationState("submitting");

    try {
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationRequestId: pendingGenerationRequestId.current,
          projectId: selectedProjectId,
          sceneId: selectedSceneId,
          modelId: "veo-3.1-generate-preview",
          promptSnapshot: prompt,
          aspectRatioSnapshot: selectedScene.aspect_ratio ?? "9:16",
          durationSecondsSnapshot: selectedScene.duration_seconds ?? 8,
          resolutionSnapshot: selectedScene.resolution ?? "1080p",
        }),
      });

      const data = await response.json();
      if (!response.ok && !data.job) throw new Error("Failed to create generation job");
      const job = data.job as GenerationJob;
      setGenerationJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setGenerationState(response.ok ? "queued" : "error");
      pendingGenerationRequestId.current = null;
      void refreshGenerationJobs();
    } catch {
      setGenerationState("error");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">▶</div>
          <div>
            <h1>Persistent AI Video Studio</h1>
            <p>Your projects stay yours, even when the API profile changes.</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="ghost-button">{backendMode === "database" ? "Database connected" : "Demo mode"}</button>
          <button className="ghost-button">Local media: Home PC</button>
          <button className="profile-button"><span className="status-dot" /> Default Google Profile⌄</button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel sidebar">
          <div className="panel-heading">
            <div><span className="eyebrow">Workspace</span><h2>Projects</h2></div>
            <button className="icon-button" onClick={createNewProject} disabled={backendMode !== "database"}>＋</button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                className={`project-card ${project.id === selectedProjectId ? "active" : ""}`}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span className="project-icon">▣</span>
                <span><strong>{project.name}</strong><small>{project.scene_count ?? 0} scenes</small></span>
              </button>
            ))}
          </div>
          <div className="storage-card">
            <div className="storage-top"><span>Local storage</span><strong>Target device</strong></div>
            <div className="meter"><span /></div>
            <small>D:\AI Video Studio</small>
          </div>
        </aside>

        <section className="panel canvas-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{selectedProject?.name ?? "Project"}</span><h2>{selectedScene?.title ?? "No scene yet"}</h2></div>
            <span className="saved-pill">● {saveState === "saving" ? "Saving" : saveState === "error" ? "Save error" : saveState === "demo" ? "Demo" : "Saved"}</span>
          </div>

          <div className="scene-tabs">
            {scenes.map((scene) => (
              <button key={scene.id} className={scene.id === selectedSceneId ? "active" : ""} onClick={() => {
                setSelectedSceneId(scene.id);
                setPrompt(scene.prompt ?? "");
              }}>{scene.title}</button>
            ))}
            <button onClick={createNewScene} disabled={backendMode !== "database"}>＋ Scene</button>
          </div>

          <div className="preview-card">
            <div className="preview-placeholder"><div className="play-ring">▶</div><span>9:16 Preview</span></div>
            <div className="reference-strip">
              <div className="reference-thumb">IMG</div>
              <div><strong>Reference image</strong><small>Image-to-video wiring comes next</small></div>
              <button className="tiny-button">Replace</button>
            </div>
          </div>

          <div className="prompt-editor">
            <div className="field-label"><span>Video prompt</span><span>Prompt v{selectedScene?.prompt_version ?? 0}</span></div>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the video scene..." />
            <div className="settings-row">
              <button className="setting-chip">Veo 3.1⌄</button>
              <button className="setting-chip">{selectedScene?.aspect_ratio ?? "9:16"}⌄</button>
              <button className="setting-chip">{selectedScene?.duration_seconds ?? 8} sec⌄</button>
              <button className="setting-chip">{selectedScene?.resolution ?? "1080p"}⌄</button>
              <button className="generate-button" onClick={createGeneration} disabled={backendMode !== "database" || !selectedSceneId || !prompt.trim() || generationState === "submitting"}>
                {generationState === "submitting" ? "Submitting…" : generationState === "error" ? "Retry Generate" : "▶ Generate"}
              </button>
            </div>
          </div>

          <div className="generations-block">
            <div className="section-title"><h3>Generation history</h3><button onClick={() => void refreshGenerationJobs()}>Refresh</button></div>
            <div className="generation-list">
              {generationJobs.length ? generationJobs.map((job) => (
                <div className="generation-row" key={job.id}>
                  <span className={`job-dot ${job.status}`} />
                  <div><strong>{job.scene_title ?? selectedScene?.title ?? "Generation"}</strong><small>{job.model_id}</small></div>
                  <span className={`job-status ${job.status}`}>{job.status.replaceAll("_", " ")}</span>
                </div>
              )) : (
                <div className="generation-row"><span className="job-dot draft" /><div><strong>No generations yet</strong><small>Configure Google, Inngest, PostgreSQL and R2 to run the full durable pipeline.</small></div><span className="job-status draft">Ready</span></div>
              )}
            </div>
          </div>
        </section>

        <aside className="panel agent-panel">
          <div className="panel-heading"><div><span className="eyebrow">Project-aware</span><h2>Agent</h2></div><span className="agent-badge">Phase 4</span></div>
          <div className="chat-stream">
            <div className="message agent-message"><strong>Veo pipeline wired.</strong><p>Generation jobs now freeze their prompt/settings, dispatch through Inngest, call Veo server-side, poll durable status, and relay completed video to R2.</p><div className="tool-list"><span>✓ Immutable generation snapshot</span><span>✓ Inngest durable worker</span><span>✓ Google Veo adapter</span><span>✓ R2 relay uploader</span></div></div>
          </div>
          <div className="agent-input"><textarea placeholder="Agent will be connected in Phase 4…" disabled /><div><button className="tiny-button" disabled>＋ Asset</button><button className="send-button" disabled>↑</button></div></div>
          <div className="relay-card"><span className="relay-icon">☁</span><div><strong>R2 relay pipeline connected</strong><small>Successful generations become CLOUD_READY only after the MP4 is uploaded and its SHA-256 metadata is persisted.</small></div></div>
        </aside>
      </section>
    </main>
  );
}
