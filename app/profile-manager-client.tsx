"use client";

import { useEffect, useMemo, useState } from "react";

type ApiProfile = {
  id: string;
  name: string;
  provider: string;
  credential_source: "environment" | "encrypted";
  enabled: boolean;
};

export default function ProfileManagerClient() {
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  const defaultProfile = useMemo(
    () => profiles.find((profile) => profile.id === defaultProfileId) ?? null,
    [profiles, defaultProfileId],
  );

  async function refresh() {
    setState("loading");
    try {
      const response = await fetch("/api/profiles", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load profiles");
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setDefaultProfileId(data.defaultProfileId ?? null);
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load profiles");
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addProfile() {
    const name = window.prompt("Profile name", `Google Profile ${profiles.length + 1}`);
    if (!name?.trim()) return;
    const apiKey = window.prompt("Google API/Auth key. It will be encrypted server-side and never returned to the browser.");
    if (!apiKey?.trim()) return;

    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), apiKey: apiKey.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to add profile");
      setMessage(`Added ${data.profile.name}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add profile");
      setState("error");
    }
  }

  async function testProfile(profile: ApiProfile) {
    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/profiles/${profile.id}/test`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Profile test failed");
      setMessage(`${profile.name} connected${data.model ? ` — ${data.model}` : ""}.`);
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile test failed");
      setState("error");
    }
  }

  async function setDefault(profile: ApiProfile) {
    if (!profile.enabled) return;
    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ makeDefault: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to set default profile");
      setDefaultProfileId(profile.id);
      setMessage(`${profile.name} is now the default execution profile.`);
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to set default profile");
      setState("error");
    }
  }

  async function toggleEnabled(profile: ApiProfile) {
    const nextEnabled = !profile.enabled;
    if (!nextEnabled && !window.confirm(`Disable ${profile.name}? Existing projects and generation history will not be changed.`)) return;

    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update profile");
      setMessage(`${profile.name} ${nextEnabled ? "enabled" : "disabled"}.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update profile");
      setState("error");
    }
  }

  return (
    <main className="settings-page">
      <section className="settings-shell">
        <div className="settings-header">
          <div>
            <span className="eyebrow">Execution settings</span>
            <h1>Google API Profiles</h1>
            <p>Profiles execute AI work. They never own projects, prompts, media, agent history, or generation history.</p>
          </div>
          <div className="settings-actions">
            <a className="ghost-button settings-link" href="/">← Workspace</a>
            <button className="profile-button" onClick={() => void addProfile()} disabled={state === "saving"}>＋ Add profile</button>
          </div>
        </div>

        <div className="profile-summary-card">
          <span>Default execution profile</span>
          <strong>{defaultProfile?.name ?? "None selected"}</strong>
        </div>

        {message ? <div className={`settings-message ${state === "error" ? "error" : ""}`}>{message}</div> : null}

        <div className="profile-table">
          <div className="profile-table-head">
            <span>Profile</span><span>Source</span><span>Status</span><span>Actions</span>
          </div>
          {profiles.map((profile) => (
            <div className="profile-table-row" key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                {profile.id === defaultProfileId ? <small>Default</small> : null}
              </div>
              <span>{profile.credential_source === "environment" ? "Server environment" : "Encrypted database"}</span>
              <span className={`profile-status ${profile.enabled ? "enabled" : "disabled"}`}>{profile.enabled ? "Enabled" : "Disabled"}</span>
              <div className="profile-row-actions">
                <button className="tiny-button" onClick={() => void testProfile(profile)} disabled={!profile.enabled || state === "saving"}>Test</button>
                <button className="tiny-button" onClick={() => void setDefault(profile)} disabled={!profile.enabled || profile.id === defaultProfileId || state === "saving"}>Set default</button>
                <button className="tiny-button" onClick={() => void toggleEnabled(profile)} disabled={state === "saving"}>{profile.enabled ? "Disable" : "Enable"}</button>
              </div>
            </div>
          ))}
          {!profiles.length && state !== "loading" ? <div className="profile-empty">No Google profiles configured yet.</div> : null}
          {state === "loading" ? <div className="profile-empty">Loading profiles…</div> : null}
        </div>
      </section>
    </main>
  );
}
