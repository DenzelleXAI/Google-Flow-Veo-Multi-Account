# Deployment and Controlled Live-Test Runbook

This project must not attempt a paid Veo generation until the deep health check and the relevant non-billable preflight pass.

Supabase is optional. The application needs PostgreSQL, not a Supabase-specific SDK or database API.

## 1. Required cloud services

Configure these for the live paid path:

1. PostgreSQL-compatible database
2. Cloudflare R2
3. Inngest
4. Authorized Google Gemini/Veo credential/profile
5. Vercel or another compatible Next.js host

Optional but recommended for the complete local-first workflow:

6. `CREDENTIAL_ENCRYPTION_KEY` for encrypted user-managed Google profiles
7. `COMPANION_TOKEN` for authenticated desktop companion delivery

For local development without a cloud database, see `DEVELOPMENT.md`.

## 2. Server environment variables

Required for paid cloud generation:

```env
DATABASE_URL=
GOOGLE_AUTH_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

Recommended:

```env
CREDENTIAL_ENCRYPTION_KEY=
COMPANION_TOKEN=
DATABASE_SSL=true
```

Do not expose credentials as `NEXT_PUBLIC_*` variables.

## 3. Apply and verify the database schema

```bash
npm install
npm run db:bootstrap
npm run db:check
```

The schema includes project persistence, encrypted profile metadata, generation idempotency, spend reservations, devices/replicas, extension lineage, R2 retention state, Agent history, and research persistence.

Run the bootstrap against the intended production PostgreSQL database before the first real test.

## 4. Verify infrastructure before spending credits

Open:

```text
GET /api/system/health?deep=1
```

Expected required checks:

- `database = ready`
- `google = ready`
- `r2 = ready`
- `inngest = ready`
- `readyForPaidGeneration = true`

The deep database health check verifies connectivity and required schema fields, including:

- spend controls
- provider operation tracking
- extension parent/depth/duration fields
- relay-retention fields
- Veo extension-reference freshness field

The endpoint never returns database credentials, Google credentials, R2 credentials, encryption keys, or companion secrets.

## 5. Run non-billable generation preflight

Before the first normal paid test:

```text
POST /api/generations/preflight
```

Example:

```json
{
  "projectId": "<project UUID>",
  "requestedApiProfileId": "<profile UUID or null>",
  "modelId": "veo-3.1-generate-preview",
  "aspectRatio": "9:16",
  "durationSeconds": 8,
  "resolution": "1080p"
}
```

Preflight checks include:

- project ownership
- model capability
- daily/monthly generation limits
- estimated request cost
- projected daily/monthly reserved spend
- target device validity
- target-device disk reserve when recently online
- Google profile availability

Preflight does **not** create a generation job and does **not** dispatch Inngest or Veo.

## 6. Spend hard stops

Initial defaults:

```text
Per request: $5.00
Per day:     $20.00
Per month:   $100.00

Generations/day:   10
Generations/month: 100
```

The job-creation transaction locks `workspace_settings` and requires:

```text
request estimate <= per-request cap
current daily reserved spend + request estimate <= daily cap
current monthly reserved spend + request estimate <= monthly cap
```

This occurs in the same transaction that protects generation idempotency.

Reservations are intentionally conservative. `FAILED_AMBIGUOUS` remains reserved because Google may already have accepted a billable request. Clearly non-billable terminal states such as `CANCELLED` and `FAILED_FINAL` are excluded.

Provider pricing can change. Re-verify current Google pricing before changing `lib/veo-pricing.ts`.

## 7. Profile management

Open:

```text
/profiles
```

Implemented actions:

- add encrypted Google profile
- test profile
- set default
- disable
- re-enable
- manually choose execution profile

Disabling or switching profiles never changes project state or prior generation history.

## 8. Controlled first paid generation

Use one small, non-critical project and one intentional Generate click.

Expected normal states:

```text
QUEUED
-> SUBMITTING
-> PROVIDER_PENDING
-> DOWNLOADING_FROM_PROVIDER
-> UPLOADING_RELAY
-> CLOUD_READY
```

After target-device delivery:

```text
CLOUD_READY
-> LOCAL_CONFIRMED
```

### Paid submission retry boundary

The Inngest function that contains the call to `generateVideos` has **zero automatic retries**.

The submit worker also refuses to call Google if any attempt for that logical job already has a `provider_operation_id`.

If provider acceptance is uncertain:

```text
FAILED_AMBIGUOUS
```

`FAILED_AMBIGUOUS` must never be retried on the same logical job. The provider may already have accepted a billable generation.

### Retry behavior when an operation ID is known

If a retryable failure already has a provider operation ID:

```text
Retry
-> restore PROVIDER_PENDING
-> resume monitor for the existing operation
-> DO NOT call generateVideos again
```

Only a retryable failure with **no** provider operation ID can safely re-enter the paid submit path.

### Monitor recovery

Provider monitoring is non-paid and recoverable.

- The immediate monitor event uses a deterministic event ID.
- A minute-level recovery function finds persisted `PROVIDER_PENDING` attempts with operation IDs and re-emits monitor events.
- Duplicate recovery/immediate events are protected with event-ID deduplication.
- If an output was already persisted before a later status write failed, monitor reconciliation marks the job complete instead of creating a duplicate output asset.

This separation is intentional:

```text
Paid submit = zero automatic retry
Known provider operation = durable/recoverable monitoring
```

## 9. Veo extension workflow

Open:

```text
/extensions
```

Every extension is an explicit paid user action.

Current enforced rules:

- Veo 3.1 Standard/Fast only
- Lite cannot extend
- 720p source/output mode
- provider request duration = 8 seconds
- provider adds 7 seconds to the combined video
- source must be a recorded generated-video output from this application
- source expected combined duration must be ≤141 seconds
- maximum 20 extensions in one lineage
- expected final combined duration is persisted
- extension source is derived by the server from the parent generation's actual output
- caller cannot spoof a source asset
- spend reservation happens before queueing

### Extension source freshness

The application enforces the current Google extension-reference window of approximately two days.

A source outside that provider window is blocked before queueing.

When an extension source is accepted for use:

- its provider-reference timestamp is refreshed after successful submission
- any scheduled R2 cleanup deadline is pushed forward to preserve the refreshed provider window

## 10. Desktop companion

Target-PC configuration:

```env
COMPANION_APP_URL=https://<your-app-host>
COMPANION_TOKEN=<same server companion token>
COMPANION_DEVICE_NAME=Home-PC
COMPANION_MEDIA_ROOT=D:\AI Video Studio
```

Run:

```bash
npm run companion
```

The companion:

1. registers/heartbeats the device
2. reports free disk space
3. requests only assets targeted to its device ID
4. receives short-lived signed R2 URLs
5. downloads to `.part`
6. computes SHA-256
7. compares it with server metadata
8. atomically renames the verified file
9. reports the verified local location

Canonical generated-video path:

```text
media/<workspace_id>/outputs/<generation_job_id>/<asset_id>.mp4
```

After the server verifies the reported hash for the designated target device:

```text
LOCAL_CONFIRMED
```

## 11. R2 lifecycle and extension retention

R2 is a transient relay, not the permanent archive, but generated videos must remain available long enough for both local recovery and provider extension.

After the **target device** verifies a generated video, the application schedules deletion no earlier than the later of:

```text
24-hour local recovery grace
OR
current Veo two-day extension-reference window
```

A non-target synced replica does not start the canonical deletion timer.

### Queue-vs-cleanup safety

Before an extension job is created, the server atomically pins the selected source in R2 by extending an already-scheduled relay deadline. That write serializes against the cleanup worker's row lock.

If cleanup already deleted the object, extension creation fails instead of creating a broken job.

### Active extension protection

The cleanup worker skips any generated video referenced as `extension_source` by an active extension job.

Protected states include:

```text
QUEUED
SUBMITTING
PROVIDER_PENDING
DOWNLOADING_FROM_PROVIDER
UPLOADING_RELAY
FAILED_RETRYABLE
```

Immediately before deleting an object, cleanup rechecks all conditions under a row lock.

R2 is marked deleted in PostgreSQL only after the R2 delete request succeeds.

An additional bucket lifecycle may be used as a long-stop safety policy, but it should not be shorter than the application's accepted recovery/extension window.

## 12. Local non-billable smoke verification

For local development, the repo includes a production-disabled smoke path.

With local PostgreSQL and the dev server running:

```bash
npm run smoke:local
```

It verifies temporary records for:

- workspace/project/scene persistence
- prompt history
- generation idempotency
- extension source pinning
- extension lineage
- +7 second duration math
- 20-extension hard stop

No Google, R2, Inngest Cloud, or Veo provider call occurs.

CI runs the same persistence smoke flow against a real PostgreSQL 16 service.

## 13. Production deployment strategy

Recommended order:

1. provision PostgreSQL
2. apply schema + `db:check`
3. configure R2
4. configure Inngest
5. configure an authorized Google profile
6. deploy a preview environment
7. run `/api/system/health?deep=1`
8. verify project CRUD and Agent persistence
9. verify image upload to R2
10. verify profile test
11. run normal generation preflight
12. run one controlled paid 720p Veo generation
13. verify `CLOUD_READY` and R2 hash
14. start the target companion
15. verify `LOCAL_CONFIRMED`
16. verify `/extensions` recognizes the 720p output as eligible
17. if desired, run one controlled extension and verify +7 second lineage
18. validate relay-retention behavior
19. only then promote the tested deployment to production

Do not put automatic multi-account quota rotation or quota farming in front of this workflow. V1 profile switching remains manual and user-authorized.
