# Persistent AI Video Studio

Flow-inspired AI video workspace where project state belongs to the application, not the currently selected Google/Veo API profile.

## Core guarantee

Changing API profiles must never reset projects, prompts, scenes, assets, agent history, generation jobs, or outputs.

## Current architecture

- **Next.js UI/API** — projects, scenes, prompts, profile selection, safety controls, generation history, and persistent Agent UI.
- **PostgreSQL** — source of truth for projects, prompts, devices, assets, profiles, agent history, jobs, attempts, outputs, and per-device media locations.
- **Inngest** — durable Veo submission, provider polling, and relay ingestion.
- **Cloudflare R2** — transient safety relay for inputs and completed generations while target PCs may be offline.
- **Desktop companion** — heartbeats a device, downloads targeted R2 outputs, verifies SHA-256, and reports verified local copies.
- **Local media folder** — intended permanent master media copy on each device.
- **Optional OneDrive / Google Drive / Syncthing / NAS** — replication between local devices after the app has verified its own target copy.
- **Gemini + Veo** — execution providers only; they never own project state.

## Media rule

Media files are not stored inside PostgreSQL. PostgreSQL stores metadata, hashes, R2 keys, relative local paths, and per-device verification state.

Generation path:

`Generate -> immutable job snapshot -> Veo -> durable monitor -> R2 -> companion -> SHA-256 verification -> LOCAL_CONFIRMED`

R2 is a transient relay, not the permanent archive. Configure an object lifecycle rule after deployment (for example 7–14 days) so cloud relay cost remains low while offline-device recovery remains possible.

## Generation lifecycle

Implemented cloud/device states include:

1. `QUEUED`
2. `SUBMITTING`
3. `PROVIDER_PENDING`
4. `DOWNLOADING_FROM_PROVIDER`
5. `UPLOADING_RELAY`
6. `CLOUD_READY`
7. `LOCAL_CONFIRMED`

Failure states:

- `FAILED_AMBIGUOUS` — Veo may have accepted a paid request but the operation ID was not safely confirmed. Never auto-resubmit this state.
- `FAILED_RETRYABLE`
- `FAILED_FINAL`
- `CANCELLED`

## Paid-request safety

### Idempotency

One `generation_request_id` represents one logical Generate action. PostgreSQL enforces:

`UNIQUE(workspace_id, generation_request_id)`

### Immutable generation inputs

A job freezes the prompt, aspect ratio, duration, resolution, model, selected API profile, target device, and image inputs at creation time.

### Atomic generation caps

`workspace_settings` is locked during job creation. The server checks daily/monthly limits before inserting the queued job, preventing simultaneous requests from racing through the cap.

Defaults:

- 10 generations/day
- 100 generations/month
- 30 GB minimum reserved free disk on a freshly reporting target device
- 5-minute device freshness window

These values are configurable through the workspace safety settings API/UI.

### Device disk behavior

A freshly reporting target device with less than the configured free-space reserve blocks generation before queueing.

An offline/stale target device does **not** block generation because R2 remains the safe landing zone. The companion downloads it when the device returns online.

### Ambiguous provider submissions

Veo submission and Veo monitoring are separate durable functions. If the provider-acceptance outcome is uncertain, the job becomes `FAILED_AMBIGUOUS` instead of being automatically resubmitted.

## API profiles

Projects do not own provider profiles.

Implemented profile behavior:

- Environment-backed Google profile
- AES-256-GCM encrypted user-managed credentials
- Add profile
- Test profile
- Enable/disable backend support
- Manual default/profile selection
- Selected profile ID frozen onto each generation job and attempt

Switching profile never changes project state.

## Veo inputs

Implemented generation inputs:

- Text-to-video
- Initial-frame image-to-video
- Last frame plumbing
- Up to three reference assets where the selected Veo model supports them
- PNG/JPEG/WebP upload to R2
- Immutable asset IDs per generation

Model capability validation is centralized before queueing.

## Persistent Agent

The right-side Agent is project-scoped and PostgreSQL-backed.

Implemented Agent capabilities:

- Persistent thread/message history
- Uses the selected Google profile
- Read project
- List scenes
- List assets
- Create scene
- Save prompt revision
- Bounded tool loop

The Agent cannot autonomously trigger paid Veo generation yet. Paid generation remains behind explicit user action until an approval/cost policy is added.

## Desktop companion

The first companion runs as a Node process and can later be wrapped in Tauri/Windows packaging.

It:

1. Registers or heartbeats the device.
2. Reports media root and current free disk.
3. Receives only R2 outputs targeted to its device ID.
4. Uses short-lived presigned R2 URLs.
5. Streams each file to a `.part` file.
6. Verifies SHA-256 against PostgreSQL metadata.
7. Atomically renames the verified file into the media folder.
8. Reports its verified relative path and hash.
9. Advances the corresponding generation from `CLOUD_READY` to `LOCAL_CONFIRMED`.

The device ID is persisted under the media root so restarting the companion does not create a new device record.

### Companion configuration

Set these values for the companion process:

```text
COMPANION_APP_URL=http://localhost:3000
COMPANION_TOKEN=<same secret as server>
COMPANION_DEVICE_NAME=Home PC
COMPANION_MEDIA_ROOT=D:\AI Video Studio
```

Then run:

```bash
npm run companion
```

`COMPANION_DEVICE_ID` is optional; normally the companion stores its assigned ID itself.

## Security boundaries

- Google credentials are server-only.
- User-managed Google keys are encrypted before database storage.
- Credentials never enter Agent prompts/tool results.
- Companion write/pending endpoints require `COMPANION_TOKEN`.
- R2 companion downloads use short-lived signed URLs.
- The server independently checks the companion-reported SHA-256 before accepting `verified` media state.
- Automatic quota/account rotation is intentionally not implemented.

## Database bootstrap

```bash
npm install
npm run db:bootstrap
```

## Local development

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Verification

GitHub Actions runs dependency installation, TypeScript typecheck, and a production Next.js build on pushes to `main`.

## Remaining major work

- Complete profile disable/re-enable UI
- Improve Agent tool-result rendering
- Add monetary cost/spend accounting in addition to generation-count limits
- Configure R2 lifecycle rules in deployed infrastructure
- Package companion as a Windows/Tauri app and optionally auto-start it
- Add Google Search + URL Context research persistence
- Configure real PostgreSQL, Inngest, R2, Google credentials, and deployment secrets
- Run the first controlled end-to-end paid Veo test
