# Persistent AI Video Studio

Flow-inspired AI video workspace where project state belongs to the application, not the currently selected Google/Veo API profile.

## Core guarantee

Changing API profiles must never reset projects, prompts, scenes, assets, agent history, research, generation jobs, or outputs.

## Architecture

- **Next.js UI/API** — project workspace and agent UI.
- **PostgreSQL** — project truth: projects, scenes, prompts, jobs, profiles, devices, metadata.
- **Cloudflare R2** — transient relay for completed cloud generations while target devices may be offline.
- **Desktop companion (planned)** — downloads R2 outputs to the device media folder and verifies SHA-256.
- **Local media folder** — permanent master copy of images/videos per device.
- **Optional OneDrive / Google Drive / Syncthing / NAS** — media replication between devices.
- **Gemini + Veo** — AI and video providers only; they never own project state.

## Important media rule

Media files are not stored inside PostgreSQL. The database stores metadata, hashes, R2 keys, and relative local paths.

A cloud-generated output flows like this:

`Veo -> cloud worker -> R2 relay -> target device companion -> SHA-256 verification -> local confirmed`

R2 is a safety relay, not the permanent archive. A lifecycle rule should remove old relay objects after a grace period.

## Generation state model

1. `DRAFT`
2. `QUEUED`
3. `SUBMITTING`
4. `PROVIDER_PENDING`
5. `DOWNLOADING_FROM_PROVIDER`
6. `UPLOADING_RELAY`
7. `CLOUD_READY`
8. `WAITING_FOR_TARGET_DEVICE`
9. `DOWNLOADING_TO_DEVICE`
10. `VERIFYING_LOCAL`
11. `LOCAL_CONFIRMED`

Failure states: `FAILED_RETRYABLE`, `FAILED_FINAL`, `CANCELLED`.

## Idempotency

One `generation_request_id` represents one logical Generate action and is reused across HTTP, queue, and worker retries. `generation_jobs` enforces `UNIQUE(workspace_id, generation_request_id)`.

## API profile rule

Projects do not own API profiles. A generation chooses a profile at execution time. V1 will support manual switching; automatic quota rotation is explicitly out of scope.

## Development phases

### Phase 1 — Persistent workspace
- Project library
- Scenes
- Prompt versions
- Asset metadata
- Autosave
- PostgreSQL
- Initial Flow-inspired UI

### Phase 2 — Single-profile Veo integration
- Seed one API profile from server environment
- Veo provider adapter
- Model capability registry
- Durable job runner
- Job/attempt/output lifecycle
- R2 relay ingestion
- Generation history

### Phase 3 — Multiple API profiles
- Encrypted user-managed credentials
- Add/test/disable profiles
- Manual profile selector

### Phase 4 — Persistent agent
- Gemini chat
- Project context loader
- Controlled project tools
- Agent history owned by PostgreSQL

### Phase 5 — Web research
- Google Search
- URL Context
- Research persistence and citations
- Prompt-injection restrictions

## Current status

The repository now contains the initial Next.js workspace UI, TypeScript configuration, environment template, and PostgreSQL schema for projects, devices, assets, per-device media locations, API profiles, idempotent generation jobs, attempts, and outputs.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Next implementation target

Wire the Phase 1 UI to PostgreSQL and implement real project/scene/asset CRUD before enabling paid Veo generation.
