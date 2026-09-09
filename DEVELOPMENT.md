# Local Development Without Supabase

Supabase is optional. The application requires PostgreSQL, not a Supabase-specific SDK, and the relay layer supports S3-compatible storage. Local development can therefore run entirely with Docker PostgreSQL + MinIO.

## Requirements

- Node.js 22+
- npm
- Docker Desktop with `docker compose`

## Fastest path

After cloning and installing dependencies:

```bash
npm install
npm run dev:local
```

`dev:local` will:

1. create `.env.local` from `.env.local.example` **only if `.env.local` does not already exist**
2. start PostgreSQL 16
3. start a local MinIO S3-compatible relay
4. create the local `flow-relay` bucket if needed
5. wait for service health checks
6. apply `db/schema.sql`
7. verify the required schema
8. start Next.js on `http://localhost:3000`

It never overwrites an existing `.env.local`.

## Local PostgreSQL details

The included Docker database listens on `127.0.0.1:54329` to reduce conflicts with an existing PostgreSQL installation.

Development-only credentials:

```text
Database: flow_studio
User:     flow
Password: flow_local_dev
Port:     54329
```

Default local connection:

```env
DATABASE_URL=postgres://flow:flow_local_dev@127.0.0.1:54329/flow_studio
DATABASE_SSL=false
```

## Local relay details

MinIO exposes:

```text
S3 API:  http://127.0.0.1:9000
Console: http://127.0.0.1:9001
Bucket:  flow-relay
User:    flow
Password: flow_local_secret
```

The generated `.env.local` uses:

```env
R2_ENDPOINT=http://127.0.0.1:9000
R2_REGION=us-east-1
R2_FORCE_PATH_STYLE=true
R2_ACCESS_KEY_ID=flow
R2_SECRET_ACCESS_KEY=flow_local_secret
R2_BUCKET=flow-relay
```

`R2_ENDPOINT` is a local/custom S3 override. In production, leave it blank and configure `R2_ACCOUNT_ID` for normal Cloudflare R2.

## Manual setup commands

If you prefer individual steps:

```bash
node scripts/ensure-local-env.mjs
npm run local:up
npm run db:local:bootstrap
npm run db:local:check
npm run dev
```

Useful commands:

```bash
npm run local:up
npm run local:down
npm run local:reset
npm run db:local:bootstrap
npm run db:local:check
```

The older `db:local:*` commands remain available when you intentionally want PostgreSQL without MinIO.

## Local non-billable persistence smoke suite

With the local development server running:

```bash
npm run smoke:local
```

The smoke routes are disabled in production and verify temporary PostgreSQL records for:

- workspace persistence
- project and scene CRUD
- prompt-version persistence
- generation request idempotency
- generated-video metadata
- extension-source relay pin semantics
- extension parent/child lineage
- +7 second expected-duration math
- 20-extension hard stop
- Asset Library listing
- per-asset verified replica aggregation
- generation media locality
- target-device `LOCAL_CONFIRMED`
- relay cleanup grace scheduling

They do **not** call Google, Veo, or Inngest Cloud and clean their temporary project/device records afterward.

## Local relay smoke test

With MinIO running:

```bash
npm run smoke:relay
```

This performs an actual local S3 flow:

1. upload an object
2. verify upload SHA-256/size metadata
3. direct readback
4. create a short-lived signed URL
5. fetch and compare the signed-URL payload
6. delete the temporary object

No Cloudflare account is required.

## What works without provider credentials

With local PostgreSQL + MinIO you can work on and test:

- persistent projects and scenes
- prompt versions/autosave
- image/asset relay plumbing
- persistent Asset Library
- persistent Generation History
- relay/local-replica state displays
- generation settings
- devices/settings metadata
- budget settings
- profile metadata UI
- Agent/research persistence structure
- generation idempotency
- extension lineage/state rules
- local database and relay health checks

Paid Generate/Extend actions intentionally remain fail-closed until a Google profile and Inngest are configured. The local MinIO relay satisfies only the storage portion of the paid-generation infrastructure gate.

## Useful app routes

```text
/             Workspace
/assets       Persistent project asset library
/generations  Persistent generation/attempt/media history
/extensions   Veo extension manager + non-billable extension preflight
/setup        Infrastructure health + generation preflight
/profiles     Google profile manager
```

## Reset all local Docker data

Warning: this deletes the local PostgreSQL **and MinIO** Docker volumes.

```bash
npm run local:reset
npm run db:local:bootstrap
```

## Stop local services

```bash
npm run local:down
```

## Generic cloud services later

No Supabase-specific client is used by the application. Any compatible PostgreSQL provider can replace the local connection by changing `DATABASE_URL`, including Neon or another managed PostgreSQL service.

The relay can similarly use Cloudflare R2 or another intentionally configured S3-compatible endpoint.

For a cloud database, normally remove `DATABASE_SSL=false` so TLS is required by the server database client and bootstrap tooling.
