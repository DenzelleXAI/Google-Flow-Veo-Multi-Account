"use client";

import { useEffect, useMemo, useState } from "react";

type Device = {
  id: string;
  name: string;
  platform?: string | null;
  media_root?: string | null;
  free_disk_bytes?: number | null;
  last_seen_at?: string | null;
  status: string;
};

type Settings = {
  default_target_device_id: string | null;
  daily_generation_limit: number;
  monthly_generation_limit: number;
  min_free_disk_bytes: number;
  device_stale_after_seconds: number;
};

function formatGb(bytes?: number | null) {
  if (bytes === null || bytes === undefined) return "Unknown free space";
  return `${(Number(bytes) / 1024 ** 3).toFixed(1)} GB free`;
}

export default function StorageControl({ enabled }: { enabled: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      fetch("/api/devices", { cache: "no-store" }).then((response) => response.ok ? response.json() : { devices: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : { settings: null }),
    ]).then(([deviceData, settingsData]) => {
      setDevices(Array.isArray(deviceData.devices) ? deviceData.devices : []);
      setSettings(settingsData.settings ?? null);
    }).catch(() => setState("error"));
  }, [enabled]);

  const selected = useMemo(
    () => devices.find((device) => device.id === settings?.default_target_device_id) ?? devices[0] ?? null,
    [devices, settings],
  );

  async function selectDevice(deviceId: string) {
    if (!settings) return;
    setState("saving");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultTargetDeviceId: deviceId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update target device");
      setSettings(data.settings);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  async function editLimits() {
    if (!settings) return;
    const dailyRaw = window.prompt("Daily generation limit", String(settings.daily_generation_limit));
    if (dailyRaw === null) return;
    const monthlyRaw = window.prompt("Monthly generation limit", String(settings.monthly_generation_limit));
    if (monthlyRaw === null) return;
    const reserveRaw = window.prompt("Minimum free disk to reserve (GB)", String(Math.round(settings.min_free_disk_bytes / 1024 ** 3)));
    if (reserveRaw === null) return;

    const daily = Number(dailyRaw);
    const monthly = Number(monthlyRaw);
    const reserveGb = Number(reserveRaw);
    if (!Number.isInteger(daily) || daily < 1 || !Number.isInteger(monthly) || monthly < daily || !Number.isFinite(reserveGb) || reserveGb < 0) {
      window.alert("Use valid limits. Monthly must be at least daily, and disk reserve cannot be negative.");
      return;
    }

    setState("saving");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dailyGenerationLimit: daily,
          monthlyGenerationLimit: monthly,
          minFreeDiskBytes: Math.round(reserveGb * 1024 ** 3),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update limits");
      setSettings(data.settings);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (!enabled) {
    return <div className="storage-card"><strong>Local storage</strong><small>Database required for device tracking.</small></div>;
  }

  return (
    <div className="storage-card">
      <div className="storage-top"><span>Target device</span><strong>{state === "saving" ? "Saving…" : state === "error" ? "Error" : "Safety on"}</strong></div>
      {devices.length ? (
        <select className="storage-select" value={selected?.id ?? ""} onChange={(event) => void selectDevice(event.target.value)} disabled={state === "saving"}>
          {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select>
      ) : <small>No desktop companion/device registered yet.</small>}
      {selected && <div className="device-summary"><strong>{selected.status}</strong><span>{formatGb(selected.free_disk_bytes)}</span><span>{selected.media_root || "Media root not reported"}</span></div>}
      {settings && <small>{settings.daily_generation_limit}/day · {settings.monthly_generation_limit}/month · reserve {Math.round(settings.min_free_disk_bytes / 1024 ** 3)} GB</small>}
      <button className="tiny-button storage-settings-button" onClick={() => void editLimits()} disabled={!settings || state === "saving"}>Safety settings</button>
    </div>
  );
}
