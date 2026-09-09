# Local Development Without Supabase

Supabase is optional. The application requires PostgreSQL, not a Supabase-specific SDK, so local development can run entirely against Docker Postgres.

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
2. start the local PostgreSQL 16 container
3. wait for the PostgreSQL health check
4. apply `db/schema.sql`
5. verify the required schema
6. start Next.js on `http://localhost:3000`

It never overwrites an existing `.env.local`.

## Local database details

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

## Manual setup commands

If you prefer individual steps:

```bash
node scripts/ensure-local-env.mjs
npm run db:local:up
npm run db:local:bootstrap
npm run db:local:check
npm run dev
```

Useful database commands:

```bash
npm run db:local:up
npm run db:local:bootstrap
npm run db:local:check
npm run db:local:down
```

## Local non-billable smoke test

With the local development server running:

```bash
npm run smoke:local
```

The smoke route is disabled in production and verifies temporary PostgreSQL records for:

- workspace persistence
- project and scene CRUD
- prompt-version persistence
- generation request idempotency
- generated-video metadata
- extension-source R2 pin semantics
- extension parent/child lineage
- +7 second expected-duration math
- 20-extension hard stop

The smoke path does **not** call Google, Veo, R2, or Inngest Cloud and cleans its temporary project afterward.

## What works without provider credentials

With only local PostgreSQL configured you can work on and test:

- persistent projects
- scenes
- prompt versions/autosave
- generation settings
- devices/settings metadata
- budget settings
- profile metadata UI
- Agent/research persistence structure
- generation idempotency
- extension lineage/state rules
- local database health checks

Paid Generate/Extend actions intentionally fail closed until Google, R2, and Inngest are configured.

## Useful app routes

```text
/             Workspace
/extensions   Veo extension manager + non-billable extension preflight
/setup        Infrastructure health + generation preflight
/profiles     Google profile manager
```

## Reset the local database

Warning: this deletes the local Docker PostgreSQL volume.

```bash
npm run db:local:reset
npm run db:local:bootstrap
```

## Stop PostgreSQL

```bash
npm run db:local:down
```

## Generic cloud PostgreSQL later

No Supabase-specific client is used by the application. Any compatible PostgreSQL provider can replace the local connection simply by changing `DATABASE_URL`, including Neon or another managed PostgreSQL service.

For a cloud database, normally remove `DATABASE_SSL=false` so TLS is required by the server database client and bootstrap tooling.
