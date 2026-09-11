import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import os from "node:os";
import { assertSafeParent, resolveMediaRoot, safeTarget } from "./path-safety.mjs";

const companionVersion = "0.4.0";
const cliArgs = process.argv.slice(2);

if (cliArgs.includes("--version") || cliArgs.includes("-v")) {
  console.log(`Persistent AI Video Studio Companion ${companionVersion}`);
  process.exit(0);
}

if (cliArgs.includes("--help") || cliArgs.includes("-h")) {
  console.log([
    `Persistent AI Video Studio Companion ${companionVersion}`,
    "",
    "Environment:",
    "  COMPANION_APP_URL       App server URL",
    "  COMPANION_TOKEN         Shared companion authentication secret",
    "  COMPANION_DEVICE_NAME   Friendly device name",
    "  COMPANION_MEDIA_ROOT    Local canonical media root",
    "  COMPANION_DEVICE_ID     Optional fixed registered device ID",
    "",
    "Options:",
    "  --version, -v            Print version and exit",
    "  --help, -h               Print help and exit",
  ].join("\n"));
  process.exit(0);
}

const appUrl = (process.env.COMPANION_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const token = process.env.COMPANION_TOKEN;
const deviceName = process.env.COMPANION_DEVICE_NAME || os.hostname();
const mediaRoot = resolve(process.env.COMPANION_MEDIA_ROOT || join(os.homedir(), "AI Video Studio"));
const configuredDeviceId = process.env.COMPANION_DEVICE_ID || "";
const stateFile = join(mediaRoot, ".persistent-video-studio-device.json");

if (!token) {
  console.error("COMPANION_TOKEN is required.");
  process.exit(1);
}

const mediaRootReal = await resolveMediaRoot(mediaRoot);

async function loadDeviceId() {
  if (configuredDeviceId) return configuredDeviceId;
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    return typeof state.deviceId === "string" ? state.deviceId : "";
  } catch {
    return "";
  }
}

async function saveDeviceId(deviceId) {
  await writeFile(stateFile, JSON.stringify({ deviceId, deviceName, mediaRoot }, null, 2), "utf8");
}

async function freeDiskBytes() {
  const info = await statfs(mediaRoot);
  return Number(info.bavail) * Number(info.bsize);
}

async function api(path, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      "x-companion-token": token,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

async function heartbeat(deviceId) {
  const data = await api("/api/devices", {
    method: "POST",
    body: JSON.stringify({
      id: deviceId || null,
      name: deviceName,
      platform: `${process.platform}/${process.arch}`,
      mediaRoot,
      freeDiskBytes: await freeDiskBytes(),
    }),
  });
  const id = String(data.device.id);
  if (id !== deviceId) await saveDeviceId(id);
  return id;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function guardTarget(target) {
  return assertSafeParent({ mediaRoot, mediaRootReal, target });
}

async function downloadAndVerify(deviceId, asset) {
  const target = safeTarget(mediaRoot, asset.relativePath);
  const part = `${target}.part`;
  await guardTarget(target);

  const existingHash = await sha256File(target).catch(() => null);
  if (existingHash === asset.sha256) {
    const file = await stat(target);
    await confirm(deviceId, asset, target, existingHash, file.size);
    console.log(`Verified existing: ${asset.relativePath}`);
    return;
  }

  await rm(part, { force: true }).catch(() => undefined);
  const response = await fetch(asset.downloadUrl);
  if (!response.ok || !response.body) throw new Error(`R2 download failed for ${asset.filename}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));

  const actualHash = await sha256File(part);
  if (actualHash !== asset.sha256) {
    await rm(part, { force: true });
    throw new Error(`SHA-256 mismatch for ${asset.filename}`);
  }

  // Re-check immediately before the final rename in case the directory tree
  // was modified while the download was in progress.
  await guardTarget(target);
  await rename(part, target);
  const file = await stat(target);
  await confirm(deviceId, asset, target, actualHash, file.size);
  console.log(`Downloaded + verified: ${asset.relativePath}`);
}

async function confirm(deviceId, asset, target, hash, size) {
  const relativePath = relative(mediaRoot, target).split(sep).join("/");
  await api(`/api/assets/${asset.assetId}/locations`, {
    method: "POST",
    body: JSON.stringify({
      deviceId,
      status: "verified",
      relativePath,
      expectedHash: asset.sha256,
      verifiedHash: hash,
      fileSizeBytes: size,
    }),
  });
}

async function syncOnce(deviceId) {
  const data = await api(`/api/companion/pending?deviceId=${encodeURIComponent(deviceId)}`);
  for (const asset of data.assets || []) {
    try {
      await downloadAndVerify(deviceId, asset);
    } catch (error) {
      console.error(`Asset ${asset.assetId} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

let deviceId = await loadDeviceId();
console.log(`Persistent AI Video Studio companion ${companionVersion}\nDevice: ${deviceName}\nMedia root: ${mediaRoot}\nServer: ${appUrl}`);

async function cycle() {
  try {
    deviceId = await heartbeat(deviceId);
    await syncOnce(deviceId);
  } catch (error) {
    console.error("Companion cycle failed:", error instanceof Error ? error.message : error);
  }
}

await cycle();
setInterval(() => void cycle(), 30_000);
