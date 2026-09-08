# Persistent AI Video Studio

Flow-inspired AI video workspace where project state belongs to the application, not the currently selected Google/Veo API profile.

## Core guarantee

Changing API profiles must never reset projects, prompts, scenes, assets, agent history, research, generation jobs, or outputs.

## Architecture

- **Next.js UI/API** — project workspace, scenes, generation controls, and later agent UI.
- **PostgreSQL** — source of truth for projects, prompts, devices, assets, profiles, jobs, attempts, and outputs.
- **Inngest** — durable asynchronous execution for Veo submission, monitoring, and relay ingestion.
- **Cloudflare R2** — transient safety relay for completed cloud generations while target devices may be offline.
- **Desktop companion (planned)** — downloads R2 outputs to the local media folder and verifies SHA-256.
- **Local media folder** — permanent master copy of images/videos per device.
- **Optional OneDrive / Google Drive / Syncthing / NAS** — media replication between devices.
- **Gemini + Veo** — execution providers only; they never own project state.

## Media rule

Media files are not stored inside PostgreSQL. The database stores metadata, hashes, R2 keys, and relative local paths.

Cloud generation path:

`Generate -> immutable job snapshot -> Veo submit -> provider operation -> durable monitor -> R2 relay -> target device companion -> SHA-256 verification -> local confirmed`

R2 is a transient safety relay, not the permanent archive. Configure an object lifecycle rule after deployment.

## Generation states

Primary cloud-side states currently implemented:

1. `QUEUED`
2. `SUBMITTING`
3. `PROVIDER_PENDING`
4. `DOWNLOADING_FROM_PROVIDER`
5. `UPLOADING_RELAY`
6. `CLOUD_READY`

Failure states:

- `FAILED_AMBIGUOUS` — provider may have accepted a paid request, but the operation ID was not safely confirmed. Never auto-resubmit this state.
- `FAILED_RETRYABLE` — monitoring, relay, or dispatch can be deliberately retried.
- `FAILED_FINAL`
- `CANCELLED`

Local-device delivery states will be added with the desktop companion.

## Paid-request safety

### Idempotent user action

One `generation_request_id` represents one logical Generate action and is reused across request retries. PostgreSQL enforces:

`UNIQUE(workspace_id, generation_request_id)`

### Immutable generation inputs

Each job snapshots the prompt, aspect ratio, duration, resolution, model, profile request, and target device at creation time. Editing a scene after clicking Generate cannot silently mutate an already queued job.

### Ambiguous provider submissions

Veo submission and Veo monitoring are separate durable functions.

The submit function does not automatically resubmit an uncertain paid request. If network failure occurs around provider acceptance, the job becomes `FAILED_AMBIGUOUS` and requires a deliberate manual retry.

After a provider operation ID is safely stored, monitoring and R2 relay work can retry independently without creating a second Veo generation.

## API profile rule

Projects do not own API profiles. A generation records which profile it uses at execution time. V1 supports one server-side profile first, then Phase 3 adds manual multi-profile switching. Automatic quota rotation is explicitly out of scope.

## Current Veo models

Capability validation is centralized for:

- `veo-3.1-generate-preview`
- `veo-3.1-fast-generate-preview`
- `veo-3.1-lite-generate-preview`

The backend validates aspect ratio, duration, and resolution before creating a paid generation job.

## Development phases

### Phase 1 — Persistent workspace

Implemented foundation:

- Project library and CRUD
- Scene CRUD
- Prompt versioning and autosave
- Device registration/heartbeat API
- Asset metadata API
- Per-device asset verification metadata
- PostgreSQL bootstrap schema
- Flow-inspired UI

### Phase 2 — Single-profile Veo integration

Implemented foundation:

- Environment-backed Google API profile
- Current Google GenAI SDK adapter
- Veo capability registry
- Immutable generation snapshots
- Idempotent generation jobs
- Job / attempt / output records
- Inngest durable submit + monitor functions
- Provider operation persistence
- R2 relay uploader
- SHA-256 relay metadata
- Live generation status polling in the UI
- Manual retry API
- Ambiguous-submission protection

Still required before a real end-to-end test:

- Configure PostgreSQL
- Configure a current Gemini auth key
- Configure Inngest
- Configure Cloudflare R2
- Run the database bootstrap
- Verify the production build in CI
- Perform a real paid Veo generation test
- Add reference-image/image-to-video transfer path

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

## Environment

Copy `.env.example` and configure the required server-side values. Credentials must never be exposed to browser JavaScript.

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

GitHub Actions runs install, TypeScript typecheck, and a production Next.js build on pushes to `main`.
