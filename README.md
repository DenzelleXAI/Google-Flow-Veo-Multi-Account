# Persistent AI Video Studio

Flow-inspired AI video workspace where project state belongs to the application, not the currently selected Google/Veo API profile.

## Core guarantee

Changing Google API profiles must never reset projects, prompts, scenes, assets, research, Agent history, generation jobs, attempts, outputs, or local-media verification state.

**Provider executes work; provider does not own work.**

## Current architecture

- **Next.js 16 UI/API** — workspace, scene settings, generation controls, Profiles, Setup, Extensions, persistent Agent, and research APIs.
- **PostgreSQL** — source of truth for project state, prompt history, devices, assets, API profiles, Agent history, research, generation jobs/attempts/outputs, budgets, and per-device replicas.
- **Inngest** — durable non-paid monitoring, relay ingestion, monitor recovery, stale-submit detection, and relay cleanup. The paid Veo submit function is intentionally zero-retry.
- **Cloudflare R2** — transient safety/working relay for input images, generated videos, extension sources, and outputs while local devices may be offline.
- **Desktop companion** — heartbeats a device, downloads targeted R2 outputs, verifies SHA-256, rejects media-path escapes through real-path checks, stores canonical local files, and reports verified replicas.
- **Local media folder** — intended long-term master media storage.
- **Optional OneDrive / Google Drive / Syncthing / NAS** — device-to-device media replication; every receiving device must still verify the actual local file hash.
- **Gemini + Veo** — reasoning/generation providers only; provider profile changes never change project identity.

## PostgreSQL is provider-independent

Supabase is **not required**. The application uses PostgreSQL directly through `DATABASE_URL`.

Supported development/deployment choices include:

- Local PostgreSQL through the included Docker Compose stack
- Neon or another managed PostgreSQL-compatible provider
- Supabase Postgres when available

Local database setup:

```bash
npm install
npm run db:local:up
npm run db:local:bootstrap
```

See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for the complete local workflow.

## Media rule

Large media blobs are never stored inside PostgreSQL. PostgreSQL stores metadata, hashes, R2 keys, relative local paths, relay-retention state, and per-device verification state.

Normal generation path:

```text
Generate
-> immutable job snapshot
-> durable pre-call submit claim
-> one allowed Veo HTTP submit attempt
-> durable provider operation ID (when acceptance is known)
-> recoverable monitor
-> R2 relay
-> companion
-> SHA-256 verification
-> LOCAL_CONFIRMED
```

Canonical generated-video paths use stable IDs:

```text
media/<workspace_id>/outputs/<generation_job_id>/<asset_id>.mp4
```

Project renames therefore do not move or invalidate canonical files.

## Generation lifecycle

Cloud/device states include:

1. `QUEUED`
2. `SUBMITTING`
3. `PROVIDER_PENDING`
4. `DOWNLOADING_FROM_PROVIDER`
5. `UPLOADING_RELAY`
6. `CLOUD_READY`
7. `LOCAL_CONFIRMED`

Failure states:

- `FAILED_AMBIGUOUS` — provider may already have accepted a billable request; same-job provider retry is prohibited.
- `FAILED_RETRYABLE` — retry policy decides whether to resume a known provider operation or safely submit when no operation exists.
- `FAILED_FINAL`
- `CANCELLED`

## Paid-request safety

### Idempotency

One `generation_request_id` represents one logical intentional Generate/Extend action. PostgreSQL enforces:

```text
UNIQUE(workspace_id, generation_request_id)
```

Network/API retries reuse the same logical job. An intentional new Generate action must create a new request ID.

### Immutable generation inputs

A generation freezes:

- prompt
- aspect ratio
- duration
- resolution
- model
- selected API profile
- target device
- initial/last/reference assets
- extension parent/source where applicable

Changing the scene later cannot mutate already-created paid work.

### Spend and count hard stops

`workspace_settings` is locked during job creation so concurrent requests cannot race through limits.

Initial defaults:

```text
10 generations/day
100 generations/month
$5.00/request
$20.00/day
$100.00/month
30 GB minimum local free-space reserve
5-minute device freshness window
```

Veo request cost is estimated before queueing and stored with a pricing-version identifier.

Ambiguous jobs remain conservatively counted because they may already be billable.

### Fail-closed paid submission

The Inngest function that calls `generateVideos` has `retries: 0`, and the Google SDK itself is configured for one HTTP attempt around the paid submit.

Google's current `generateVideos` interface does **not** expose a provider-side idempotency/request key. Therefore the application does not claim mathematically exact-once remote execution across an arbitrary process crash.

Instead, each generation attempt acquires a durable database submit claim **before** the non-idempotent Veo HTTP call. That claim can only be acquired once. If the worker process is killed after the claim and before a provider operation ID is durably stored, replay fails closed and does **not** call Veo again.

Tradeoff:

```text
possible false-positive ambiguity
is accepted over
possible duplicate paid generation
```

A minute-level stale-submit detector marks a claimed `SUBMITTING` attempt with no operation ID as `FAILED_AMBIGUOUS` after the safety timeout and emits a critical operator log. That logical paid job must not be automatically resubmitted.

A submit worker also refuses to call the provider if any attempt for that job already has a provider operation ID, protecting against late or replayed submit events.

Once an operation ID is known:

```text
retry = resume monitoring
NOT submit Veo again
```

`FAILED_AMBIGUOUS` can never retry the same logical paid job.

### Monitor recovery

Provider monitoring is non-paid and recoverable.

- Immediate monitor events use deterministic event IDs.
- A recovery cron scans persisted `PROVIDER_PENDING` attempts with operation IDs and re-emits monitor events when necessary.
- Monitor retries reconcile any already-persisted output before downloading/storing another asset.

This separates **fail-closed paid-submit protection** from **recoverable non-paid monitoring**.

## API profiles

Projects do not own provider profiles.

Implemented behavior:

- Environment-backed Google profile
- AES-256-GCM encrypted user-managed profiles
- Add profile
- Test profile
- Enable / disable / re-enable
- Set default
- Manual per-generation selection
- Selected profile ID frozen onto the generation job/attempt

Switching profiles changes execution credentials only.

## Veo generation inputs

Implemented:

- Text-to-video
- Initial-frame image-to-video
- Last-frame interpolation
- Up to three subject/product reference images where supported
- PNG/JPEG/WebP upload to R2
- 9:16 / 16:9
- 4 / 6 / 8 second generation where supported
- 720p / 1080p / 4K according to current model capability
- Capability-driven validation before paid queueing

Current app registry distinguishes:

- **Veo 3.1 Standard** — 720p / 1080p / 4K; references; extension
- **Veo 3.1 Fast** — 720p / 1080p / 4K; references; extension
- **Veo 3.1 Lite** — 720p / 1080p; no reference-image mode; no extension

1080p/4K and reference-image generation are constrained to 8 seconds by the current provider rules.

## Veo extension workflow

Open:

```text
/extensions
```

Extension is always an **explicit paid user action**.

Implemented constraints:

- Standard/Fast only
- 720p source/output mode
- provider API duration fixed to 8 seconds
- provider adds 7 seconds to the combined video
- source must be an app-recorded generated Veo video
- source combined duration must be ≤141 seconds
- maximum 20 extensions per lineage
- final expected combined duration tracked in PostgreSQL
- source asset frozen as `extension_source`
- parent/child generation lineage persisted
- spend reserved before queueing

The app also enforces the provider's current two-day extension-reference window. A source referenced successfully for extension refreshes that provider-reference timestamp.

## R2 relay retention

R2 is transient, but extension-capable videos cannot be deleted too aggressively.

After the **target device** verifies a generated output, deletion is scheduled no earlier than the later of:

```text
24-hour local recovery grace
OR
current Veo two-day extension-reference window
```

When an extension is queued, its source is atomically pinned in R2 before the job is created. A successful provider reference refreshes the provider-reference timestamp and pushes any scheduled relay deletion forward.

The cleanup worker:

- requires a verified local replica
- skips active extension sources
- rechecks eligibility under a row lock immediately before R2 deletion
- records `relay_deleted_at` only after the delete request succeeds

## Persistent Agent

The right-side Agent is project-scoped and PostgreSQL-backed.

Implemented Agent capabilities:

- Persistent thread/message history
- Selected Google profile execution
- Read project
- List scenes/assets
- Create scene
- Save prompt revision
- Bounded tool loop
- Reuse persisted research
- Run fresh Google Search / URL Context research

Paid Veo generation is intentionally **not** an autonomous Agent tool. Expensive generation remains behind explicit user actions.

## Persistent research

Google Search and URL Context findings can be saved as project research sessions and sources.

Stored context includes:

- query
- summary
- search queries
- source URLs/titles
- citation positions/metadata
- selected API profile

Web content is treated as untrusted evidence and cannot authorize credential changes, budget changes, deletion, permission changes, or paid generations.

## Desktop companion

The companion is available as a Node process and as a standalone Windows executable artifact.

It:

1. Registers or heartbeats the device.
2. Reports media root and free disk.
3. Receives only outputs targeted to its device ID.
4. Gets short-lived presigned R2 URLs rather than R2 credentials.
5. Lexically validates the requested media path.
6. Resolves the actual parent path and rejects symlink/junction escapes outside the configured media root.
7. Streams to a `.part` file.
8. Computes SHA-256.
9. Verifies the hash against server metadata.
10. Re-checks the real parent path immediately before atomic rename.
11. Atomically renames the verified file.
12. Reports the verified local replica.
13. Advances the targeted generation to `LOCAL_CONFIRMED` after server-side hash verification.

Companion configuration:

```text
COMPANION_APP_URL=http://localhost:3000
COMPANION_TOKEN=<same server secret>
COMPANION_DEVICE_NAME=Home PC
COMPANION_MEDIA_ROOT=D:\AI Video Studio
```

Run development companion:

```bash
npm run companion
```

## Setup and health UI

Useful routes:

```text
/             Workspace
/extensions   Veo extension manager
/setup        Infrastructure health + non-billable preflight
/profiles     Google profile manager
```

Deep health endpoint:

```text
GET /api/system/health?deep=1
```

It verifies connectivity plus required database tables/columns without exposing secrets.

## Local non-billable verification

CI and local development can validate persistence without Google/R2/Inngest credentials.

With local Postgres and the dev server running:

```bash
npm run smoke:local
```

The smoke path is production-disabled and tests temporary data for:

- workspace/project/scene persistence
- prompt versions
- generation idempotency
- extension-source pinning
- parent/child extension lineage
- +7 second duration math
- 20-extension hard stop

No provider call occurs.

## CI

Every push to `main` currently runs:

1. PostgreSQL 16 service
2. schema bootstrap
3. schema verification
4. Veo/retry/safety regression tests
5. TypeScript typecheck
6. local Next.js persistence/extension smoke test
7. production Next.js build

The Windows companion workflow additionally builds the standalone executable, runs its `--version` self-check, validates the package layout, and uploads the artifact.

## Security boundaries

- Google credentials are server-only.
- User-managed Google credentials are encrypted before database storage.
- Credentials never enter Agent prompts/tool results.
- Companion endpoints require `COMPANION_TOKEN`.
- R2 companion downloads use short-lived signed URLs.
- Server independently verifies companion SHA-256 reports.
- Paid provider submission has no automatic retry.
- Paid-submit replay after an unconfirmed process interruption fails closed as ambiguous.
- Companion writes are constrained by lexical and real-path media-root checks.
- Automatic account rotation/quota farming is intentionally not implemented.

## Deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

Still required before the first live paid end-to-end test:

- choose/configure a production PostgreSQL provider
- configure Cloudflare R2
- configure Inngest
- configure at least one authorized Google profile
- link/deploy the repository to a Next.js host such as Vercel
- run deep health + preflight
- perform one controlled paid Veo generation and verify cloud → R2 → local delivery
