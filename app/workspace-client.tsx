"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AgentPanel from "./agent-panel";
import StorageControl from "./storage-control";

type Project = { id: string; name: string; description?: string | null; scene_count?: number };
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
type Asset = { id: string; filename: string; type: string; mime_type?: string | null; sha256?: string | null };
type GenerationJob = {
  id: string;
  status: string;
  model_id: string;
  scene_title?: string | null;
  requested_api_profile_id?: string | null;
  outputs?: Array<{ asset_id: string; filename: string; r2_key?: string | null }>;
};
type ApiProfile = {
  id: string;
  name: string;
  provider: string;
  credential_source: "environment" | "encrypted";
  enabled: boolean;
};
type VeoModelId =
  | "veo-3.1-generate-preview"
  | "veo-3.1-fast-generate-preview"
  | "veo-3.1-lite-generate-preview";
type UploadRole = "initial" | "last" | "reference";

const veoCapabilities: Record<
  VeoModelId,
  { label: string; resolutions: readonly string[]; supportsReferences: boolean }
> = {
  "veo-3.1-generate-preview": {
    label: "Veo 3.1",
    resolutions: ["720p", "1080p", "4k"],
    supportsReferences: true,
  },
  "veo-3.1-fast-generate-preview": {
    label: "Veo 3.1 Fast",
    resolutions: ["720p", "1080p", "4k"],
    supportsReferences: true,
  },
  "veo-3.1-lite-generate-preview": {
    label: "Veo 3.1 Lite",
    resolutions: ["720p", "1080p"],
    supportsReferences: false,
  },
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
  const [generationError, setGenerationError] = useState("");
  const [modelId, setModelId] = useState<VeoModelId>("veo-3.1-generate-preview");
  const [initialFrame, setInitialFrame] = useState<Asset | null>(null);
  const [lastFrame, setLastFrame] = useState<Asset | null>(null);
  const [referenceImages, setReferenceImages] = useState<Asset[]>([]);
  const [uploadState, setUploadState] = useState<{ role: UploadRole | null; state: "idle" | "uploading" | "error" }>({ role: null, state: "idle" });
  const [settingsState, setSettingsState] = useState<"idle" | "saving" | "error">("idle");
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileState, setProfileState] = useState<"idle" | "saving" | "testing" | "error">("idle");
  const pendingGenerationRequestId = useRef<string | null>(null);
  const initialInputRef = useRef<HTMLInputElement | null>(null);
  const lastInputRef = useRef<HTMLInputElement | null>(null);
  const referencesInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );
  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0],
    [scenes, selectedSceneId],
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.enabled),
    [profiles, selectedProfileId],
  );
  const modelCapability = veoCapabilities[modelId];
  const aspectRatio = selectedScene?.aspect_ratio ?? "9:16";
  const resolution = selectedScene?.resolution ?? "1080p";
  const durationSeconds = selectedScene?.duration_seconds ?? 8;
  const forceEightSeconds = resolution === "1080p" || resolution === "4k" || referenceImages.length > 0;
  const uploadInProgress = uploadState.state === "uploading";

  async function refreshGenerationJobs(projectId = selectedProjectId) {
    if (backendMode !== "database" || !projectId) return;
    try {
      const response = await fetch(`/api/generations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = response.ok ? await response.json() : { jobs: [] };
      setGenerationJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {}
  }

  async function refreshProfiles() {
    if (backendMode !== "database") return;
    try {
      const response = await fetch("/api/profiles", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const nextProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(nextProfiles);
      setSelectedProfileId(data.defaultProfileId || nextProfiles.find((profile: ApiProfile) => profile.enabled)?.id || "");
    } catch {}
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
    if (backendMode === "database") void refreshProfiles();
  }, [backendMode]);

  useEffect(() => {
    if (backendMode !== "database" || !selectedProjectId) return;
    setInitialFrame(null);
    setLastFrame(null);
    setReferenceImages([]);
    setGenerationError("");
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
    const timer = window.setInterval(() => void refreshGenerationJobs(), 5000);
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

  async function updateSceneSettings(patch: {
    aspectRatio?: string;
    durationSeconds?: number;
    resolution?: string;
  }) {
    if (backendMode !== "database" || !selectedSceneId) return;
    setSettingsState("saving");
    try {
      const response = await fetch(`/api/scenes/${selectedSceneId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update scene settings");
      setScenes((current) => current.map((scene) => (scene.id === selectedSceneId ? { ...scene, ...data.scene } : scene)));
      setSettingsState("idle");
    } catch (error) {
      setSettingsState("error");
      setGenerationError(error instanceof Error ? error.message : "Failed to save scene settings");
    }
  }

  async function uploadVeoImage(file: File, role: UploadRole) {
    if (backendMode !== "database" || !selectedProjectId) return;
    if (role === "reference" && (!modelCapability.supportsReferences || referenceImages.length >= 3)) return;
    if (role === "last" && !initialFrame) return;

    setUploadState({ role, state: "uploading" });
    setGenerationError("");
    try {
      const form = new FormData();
      form.append("projectId", selectedProjectId);
      form.append("type", role === "initial" ? "START_FRAME" : role === "last" ? "END_FRAME" : "REFERENCE_IMAGE");
      form.append("file", file);
      const response = await fetch("/api/assets/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed");
      const asset = data.asset as Asset;

      if (role === "initial") setInitialFrame(asset);
      if (role === "last") setLastFrame(asset);
      if (role === "reference") {
        setReferenceImages((current) => (current.some((item) => item.id === asset.id) ? current : [...current, asset].slice(0, 3)));
        if (durationSeconds !== 8) await updateSceneSettings({ durationSeconds: 8 });
      }
      setUploadState({ role: null, state: "idle" });
    } catch (error) {
      setUploadState({ role, state: "error" });
      setGenerationError(error instanceof Error ? error.message : "Image upload failed");
    }
  }

  async function chooseModel(nextModelId: VeoModelId) {
    setModelId(nextModelId);
    const capability = veoCapabilities[nextModelId];
    const patch: { resolution?: string; durationSeconds?: number } = {};

    if (!capability.supportsReferences) setReferenceImages([]);
    if (!capability.resolutions.includes(resolution)) patch.resolution = "1080p";
    const nextResolution = patch.resolution ?? resolution;
    if ((nextResolution === "1080p" || nextResolution === "4k") && durationSeconds !== 8) {
      patch.durationSeconds = 8;
    }
    if (Object.keys(patch).length) await updateSceneSettings(patch);
  }

  async function chooseResolution(nextResolution: string) {
    const patch: { resolution: string; durationSeconds?: number } = { resolution: nextResolution };
    if ((nextResolution === "1080p" || nextResolution === "4k") && durationSeconds !== 8) patch.durationSeconds = 8;
    await updateSceneSettings(patch);
  }

  async function chooseDuration(nextDuration: number) {
    if (forceEightSeconds && nextDuration !== 8) return;
    await updateSceneSettings({ durationSeconds: nextDuration });
  }

  function removeInitialFrame() {
    setInitialFrame(null);
    setLastFrame(null);
  }

  async function chooseProfile(profileId: string) {
    setSelectedProfileId(profileId);
    if (backendMode !== "database" || !profileId) return;
    setProfileState("saving");
    try {
      const response = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ makeDefault: true }),
      });
      if (!response.ok) throw new Error("Profile switch failed");
      setProfileState("idle");
    } catch {
      setProfileState("error");
    }
  }

  async function addProfile() {
    if (backendMode !== "database") return;
    const name = window.prompt("Profile name", `Google Profile ${profiles.length + 1}`);
    if (!name?.trim()) return;
    const apiKey = window.prompt("Google API/Auth key. It will be encrypted server-side and never returned to the browser.");
    if (!apiKey?.trim()) return;
    setProfileState("saving");
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to add profile");
      const profile = data.profile as ApiProfile;
      setProfiles((current) => [...current, profile]);
      await chooseProfile(profile.id);
      setProfileState("idle");
    } catch {
      setProfileState("error");
    }
  }

  async function testSelectedProfile() {
    if (!selectedProfileId) return;
    setProfileState("testing");
    try {
      const response = await fetch(`/api/profiles/${selectedProfileId}/test`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Profile test failed");
      window.alert(`Profile connected${data.model ? ` — ${data.model}` : ""}`);
      setProfileState("idle");
    } catch {
      setProfileState("error");
    }
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

    if (lastFrame && !initialFrame) {
      setGenerationError("A last frame requires an initial frame.");
      return;
    }
    if (referenceImages.length && !modelCapability.supportsReferences) {
      setGenerationError(`${modelCapability.label} does not support reference images.`);
      return;
    }
    if (!modelCapability.resolutions.includes(resolution)) {
      setGenerationError(`${modelCapability.label} does not support ${resolution}.`);
      return;
    }
    if (forceEightSeconds && durationSeconds !== 8) {
      setGenerationError("This configuration requires an 8-second duration.");
      return;
    }

    if (!pendingGenerationRequestId.current) pendingGenerationRequestId.current = crypto.randomUUID();
    setGenerationState("submitting");
    setGenerationError("");

    const assetInputs = [
      ...(initialFrame ? [{ assetId: initialFrame.id, role: "initial_frame", sortOrder: 0 }] : []),
      ...(lastFrame ? [{ assetId: lastFrame.id, role: "last_frame", sortOrder: 0 }] : []),
      ...referenceImages.map((asset, index) => ({ assetId: asset.id, role: "reference_asset", sortOrder: index })),
    ];

    try {
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationRequestId: pendingGenerationRequestId.current,
          projectId: selectedProjectId,
          sceneId: selectedSceneId,
          requestedApiProfileId: selectedProfileId || null,
          modelId,
          promptSnapshot: prompt,
          aspectRatioSnapshot: aspectRatio,
          durationSecondsSnapshot: durationSeconds,
          resolutionSnapshot: resolution,
          assetInputs,
        }),
      });
      const data = await response.json();
      if (!response.ok && !data.job) {
        setGenerationError(data.error ?? "Generation blocked");
        throw new Error(data.error ?? "Failed to create generation job");
      }
      const job = data.job as GenerationJob;
      setGenerationJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setGenerationState(response.ok ? "queued" : "error");
      pendingGenerationRequestId.current = null;
      void refreshGenerationJobs();
    } catch {
      setGenerationState("error");
    }
  }

  const inputStatusText = (role: UploadRole, readyText: string, emptyText: string) => {
    if (uploadState.role === role && uploadState.state === "uploading") return "Uploading to R2…";
    if (uploadState.role === role && uploadState.state === "error") return "Upload failed — try again";
    return readyText || emptyText;
  };

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
          <select
            className="profile-select"
            value={selectedProfileId}
            onChange={(event) => void chooseProfile(event.target.value)}
            disabled={backendMode !== "database" || profileState === "saving"}
          >
            {!profiles.length && <option value="">Default Google Profile</option>}
            {profiles.filter((profile) => profile.enabled).map((profile) => (
              <option value={profile.id} key={profile.id}>{profile.name}</option>
            ))}
          </select>
          <button className="profile-button" onClick={() => void testSelectedProfile()} disabled={!selectedProfileId || profileState === "testing"}>
            {profileState === "testing" ? "Testing…" : "Test"}
          </button>
          <button className="profile-button" onClick={() => void addProfile()} disabled={backendMode !== "database" || profileState === "saving"}>＋ Profile</button>
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
          <StorageControl enabled={backendMode === "database"} />
        </aside>

        <section className="panel canvas-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{selectedProject?.name ?? "Project"}</span><h2>{selectedScene?.title ?? "No scene yet"}</h2></div>
            <span className="saved-pill">● {saveState === "saving" ? "Saving" : saveState === "error" ? "Save error" : saveState === "demo" ? "Demo" : "Saved"}</span>
          </div>

          <div className="scene-tabs">
            {scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedSceneId ? "active" : ""}
                onClick={() => { setSelectedSceneId(scene.id); setPrompt(scene.prompt ?? ""); }}
              >
                {scene.title}
              </button>
            ))}
            <button onClick={createNewScene} disabled={backendMode !== "database"}>＋ Scene</button>
          </div>

          <div className="preview-card">
            <div className="preview-placeholder">
              <div className="play-ring">▶</div>
              <span>{aspectRatio} Preview</span>
            </div>

            <div className="veo-input-stack">
              <div className="reference-strip">
                <div className="reference-thumb">1ST</div>
                <div>
                  <strong>{initialFrame?.filename ?? "Initial frame"}</strong>
                  <small>{inputStatusText("initial", initialFrame ? "Primary image-to-video frame" : "", "Optional — PNG, JPEG, or WebP")}</small>
                </div>
                <input
                  ref={initialInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadVeoImage(file, "initial");
                    event.currentTarget.value = "";
                  }}
                />
                {initialFrame && <button className="tiny-button" onClick={removeInitialFrame}>Remove</button>}
                <button className="tiny-button" onClick={() => initialInputRef.current?.click()} disabled={backendMode !== "database" || uploadInProgress}>
                  {initialFrame ? "Replace" : "Choose"}
                </button>
              </div>

              <div className="reference-strip">
                <div className="reference-thumb">END</div>
                <div>
                  <strong>{lastFrame?.filename ?? "Last frame"}</strong>
                  <small>{inputStatusText("last", lastFrame ? "Interpolation end frame" : "", initialFrame ? "Optional ending frame" : "Choose an initial frame first")}</small>
                </div>
                <input
                  ref={lastInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadVeoImage(file, "last");
                    event.currentTarget.value = "";
                  }}
                />
                {lastFrame && <button className="tiny-button" onClick={() => setLastFrame(null)}>Remove</button>}
                <button className="tiny-button" onClick={() => lastInputRef.current?.click()} disabled={backendMode !== "database" || uploadInProgress || !initialFrame}>
                  {lastFrame ? "Replace" : "Choose"}
                </button>
              </div>

              <div className="reference-strip reference-assets-strip">
                <div className="reference-thumb">REF</div>
                <div className="reference-assets-copy">
                  <strong>Reference assets · {referenceImages.length}/3</strong>
                  <small>
                    {modelCapability.supportsReferences
                      ? inputStatusText("reference", referenceImages.length ? "Subject/product continuity references · forces 8s" : "", "Optional — Standard/Fast only")
                      : `${modelCapability.label} does not support reference images`}
                  </small>
                  {!!referenceImages.length && (
                    <div className="reference-pills">
                      {referenceImages.map((asset) => (
                        <button key={asset.id} type="button" onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== asset.id))}>
                          {asset.filename} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={referencesInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={(event) => {
                    const remaining = 3 - referenceImages.length;
                    const files = Array.from(event.target.files ?? []).slice(0, remaining);
                    void (async () => {
                      for (const file of files) await uploadVeoImage(file, "reference");
                    })();
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  className="tiny-button"
                  onClick={() => referencesInputRef.current?.click()}
                  disabled={backendMode !== "database" || uploadInProgress || !modelCapability.supportsReferences || referenceImages.length >= 3}
                >
                  Add refs
                </button>
              </div>
            </div>
          </div>

          <div className="prompt-editor">
            <div className="field-label"><span>Video prompt</span><span>Prompt v{selectedScene?.prompt_version ?? 0}</span></div>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the video scene..." />
            <div className="settings-row">
              <select className="setting-select" value={modelId} onChange={(event) => void chooseModel(event.target.value as VeoModelId)}>
                {(Object.entries(veoCapabilities) as Array<[VeoModelId, (typeof veoCapabilities)[VeoModelId]]>).map(([id, capability]) => (
                  <option value={id} key={id}>{capability.label}</option>
                ))}
              </select>

              <select className="setting-select" value={aspectRatio} onChange={(event) => void updateSceneSettings({ aspectRatio: event.target.value })} disabled={!selectedSceneId || settingsState === "saving"}>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
              </select>

              <select className="setting-select" value={durationSeconds} onChange={(event) => void chooseDuration(Number(event.target.value))} disabled={!selectedSceneId || settingsState === "saving"}>
                {[4, 6, 8].map((seconds) => (
                  <option key={seconds} value={seconds} disabled={forceEightSeconds && seconds !== 8}>{seconds} sec</option>
                ))}
              </select>

              <select className="setting-select" value={resolution} onChange={(event) => void chooseResolution(event.target.value)} disabled={!selectedSceneId || settingsState === "saving"}>
                {modelCapability.resolutions.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>

              <button
                className="generate-button"
                onClick={createGeneration}
                disabled={backendMode !== "database" || !selectedSceneId || !prompt.trim() || generationState === "submitting" || uploadInProgress || settingsState === "saving"}
              >
                {generationState === "submitting"
                  ? "Submitting…"
                  : generationState === "error"
                    ? "Retry Generate"
                    : initialFrame || referenceImages.length
                      ? "▶ Generate with images"
                      : "▶ Generate"}
              </button>
            </div>
            <div className="execution-note">
              Execution profile: <strong>{selectedProfile?.name ?? "Default Google Profile"}</strong> · {modelCapability.label} · {resolution} · {durationSeconds}s.
              {forceEightSeconds ? " This configuration is locked to 8 seconds." : ""}
              {settingsState === "saving" ? " Saving scene settings…" : ""}
            </div>
            {generationError && <div className="generation-error">Generation blocked: {generationError}</div>}
          </div>

          <div className="generations-block">
            <div className="section-title"><h3>Generation history</h3><button onClick={() => void refreshGenerationJobs()}>Refresh</button></div>
            <div className="generation-list">
              {generationJobs.length ? generationJobs.map((job) => (
                <div className="generation-row" key={job.id}>
                  <span className={`job-dot ${job.status}`} />
                  <div><strong>{job.scene_title ?? selectedScene?.title ?? "Generation"}</strong><small>{job.model_id}{job.requested_api_profile_id ? " · profile locked" : ""}</small></div>
                  <span className={`job-status ${job.status}`}>{job.status.replaceAll("_", " ")}</span>
                </div>
              )) : (
                <div className="generation-row">
                  <span className="job-dot draft" />
                  <div><strong>No generations yet</strong><small>PostgreSQL works locally; Google, Inngest and R2 are only needed for the paid generation pipeline.</small></div>
                  <span className="job-status draft">Ready</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {backendMode === "database"
          ? <AgentPanel projectId={selectedProjectId} apiProfileId={selectedProfileId || null} />
          : <AgentPanel projectId="" apiProfileId={null} />}
      </section>
    </main>
  );
}
