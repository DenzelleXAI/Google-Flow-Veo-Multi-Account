"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./profile-manager-client.module.css";

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
  const [addOpen, setAddOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

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

  function openAddProfile() {
    setNewProfileName(`Google Profile ${profiles.length + 1}`);
    setNewApiKey("");
    setMessage("");
    setAddOpen(true);
  }

  function closeAddProfile() {
    if (state === "saving") return;
    setNewApiKey("");
    setNewProfileName("");
    setAddOpen(false);
  }

  async function addProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newProfileName.trim();
    const apiKey = newApiKey.trim();
    if (!name || !apiKey) return;

    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to add profile");

      // Never retain the credential in browser state after the request has
      // completed. The server stores only the encrypted credential.
      setNewApiKey("");
      setNewProfileName("");
      setAddOpen(false);
      setMessage(`Added ${data.profile.name}.`);
      await refresh();
    } catch (error) {
      setNewApiKey("");
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
            <button className="profile-button" onClick={openAddProfile} disabled={state === "saving"}>＋ Add profile</button>
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

      {addOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAddProfile();
        }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="add-profile-title">
            <div className={styles.modalHeader}>
              <div>
                <span className="eyebrow">Encrypted credential</span>
                <h2 id="add-profile-title">Add Google API profile</h2>
                <p>The API key is sent directly to the server for encryption and is never returned by profile APIs.</p>
              </div>
              <button className={styles.closeButton} type="button" onClick={closeAddProfile} disabled={state === "saving"} aria-label="Close">×</button>
            </div>

            <form className={styles.form} onSubmit={(event) => void addProfile(event)}>
              <label className={styles.field}>
                <span>Profile name</span>
                <input
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  autoComplete="off"
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>

              <label className={styles.field}>
                <span>Google API/Auth key</span>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(event) => setNewApiKey(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  required
                />
              </label>

              <p className={styles.helper}>The key is kept only for this request in browser memory, then the field is cleared on success, failure, or close.</p>

              <div className={styles.actions}>
                <button className={styles.secondary} type="button" onClick={closeAddProfile} disabled={state === "saving"}>Cancel</button>
                <button className={styles.primary} type="submit" disabled={state === "saving" || !newProfileName.trim() || !newApiKey.trim()}>
                  {state === "saving" ? "Encrypting…" : "Add encrypted profile"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
