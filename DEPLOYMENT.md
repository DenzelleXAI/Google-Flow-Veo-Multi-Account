# Deployment and Controlled Live-Test Runbook

This project should not attempt a paid Veo generation until the health endpoint and generation preflight both pass.

## 1. Required cloud services

Configure these first:

1. PostgreSQL
2. Cloudflare R2
3. Inngest
4. Google Gemini/Veo credential
5. Vercel or equivalent Next.js hosting

Optional but recommended for the full local-first workflow:

6. `CREDENTIAL_ENCRYPTION_KEY` for encrypted user-managed Google profiles
7. `COMPANION_TOKEN` for authenticated desktop companion delivery

## 2. Server environment variables

Required for the paid cloud generation path:

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

Do not expose these as `NEXT_PUBLIC_*` variables.

## 3. Apply the database schema

```bash
npm install
npm run db:bootstrap
```

Run this against the intended production PostgreSQL database before the first real test.

## 4. Verify the application before spending credits

Open:

```text
GET /api/system/health?deep=1
```

The response should report:

- `database = ready`
- `google = ready`
- `r2 = ready`
- `inngest = ready`
- `readyForPaidGeneration = true`

The endpoint never returns API keys, R2 credentials, database credentials, encryption keys, or companion secrets.

## 5. Run generation preflight

Before the first paid test, POST the same settings that will be used by the UI:

```text
POST /api/generations/preflight
```

Example JSON:

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

Preflight checks:

- project ownership
- model capability
- daily limit
- monthly limit
- target device validity
- target-device disk reserve when recently online
- selected/default Google profile availability

It does **not** create a generation job and does **not** dispatch Inngest or Veo.

## 6. Profile management

Open:

```text
/profiles
```

Use this page to:

- add an encrypted Google profile
- test a profile
- set the default execution profile
- disable a bad profile
- re-enable a profile

Disabling a profile never deletes or changes projects, prompts, media, agent history, or prior generation attempts.

## 7. Controlled first paid Veo test

Use one short, non-critical project and one explicit Generate click.

Expected state sequence:

```text
QUEUED
-> SUBMITTING
-> PROVIDER_PENDING
-> DOWNLOADING_FROM_PROVIDER
-> UPLOADING_RELAY
-> CLOUD_READY
```

If submission becomes ambiguous, expected state is:

```text
FAILED_AMBIGUOUS
```

Do not automatically resubmit that state because the provider may already have accepted a billable request.

## 8. Desktop companion

On the target PC configure:

```env
APP_BASE_URL=https://<your-app-host>
COMPANION_TOKEN=<same server companion token>
COMPANION_DEVICE_NAME=Home-PC
COMPANION_MEDIA_ROOT=D:\AI Video Studio
```

Then run:

```bash
npm run companion
```

The companion:

1. registers/heartbeats the device
2. reports current free disk space
3. asks only for outputs targeted to that device
4. receives a short-lived signed R2 URL
5. downloads to a `.part` file
6. computes SHA-256
7. compares it with the server's expected hash
8. atomically renames the verified file
9. reports the verified local location

After server-side hash confirmation the generation becomes:

```text
LOCAL_CONFIRMED
```

## 9. R2 lifecycle

R2 is a transient relay, not the permanent media library.

Recommended initial retention while testing: **14 days**.

Do not aggressively delete relay objects immediately after one download. Keep a recovery window until the local-first delivery workflow has proven stable.

## 10. Production deployment strategy

Recommended order:

1. deploy a preview environment
2. run `/api/system/health?deep=1`
3. verify project CRUD and agent persistence
4. verify image upload to R2
5. verify profile test
6. verify generation preflight
7. run one controlled paid Veo generation
8. verify R2 output hash
9. start the companion
10. verify `LOCAL_CONFIRMED`
11. only then promote the tested deployment to production

Do not put an automatic multi-account quota rotation system in front of this workflow. V1 switching remains manual and user-authorized.
