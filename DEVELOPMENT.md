# Local Development Without Supabase

Supabase is optional. The application only requires a PostgreSQL-compatible `DATABASE_URL`, so local development can run entirely against Docker Postgres.

## Requirements

- Node.js 22+
- npm
- Docker Desktop with `docker compose`

## 1. Start PostgreSQL

```bash
npm run db:local:up
```

The local database listens on `127.0.0.1:54329` so it is less likely to collide with an existing PostgreSQL installation.

Local credentials are development-only:

```text
Database: flow_studio
User:     flow
Password: flow_local_dev
Port:     54329
```

## 2. Create `.env.local`

Copy `.env.local.example` to `.env.local`.

Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

Command Prompt:

```cmd
copy .env.local.example .env.local
```

macOS/Linux:

```bash
cp .env.local.example .env.local
```

The default local connection is:

```env
DATABASE_URL=postgres://flow:flow_local_dev@127.0.0.1:54329/flow_studio
DATABASE_SSL=false
```

## 3. Apply the schema

```bash
npm run db:local:bootstrap
```

The bootstrap script applies `db/schema.sql` using the local Docker database and disables SSL for this local connection only.

## 4. Verify the database

With `.env.local` loaded into your shell, or by setting `LOCAL_DATABASE_URL`, run:

```bash
npm run db:check
```

Expected output includes:

```text
Database connection: OK
Schema tables: 17/17 present
```

## 5. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Projects, scenes, prompt versions, devices, settings, assets metadata, and other PostgreSQL-backed state can now be developed without Supabase.

Paid generation remains intentionally blocked until Google, R2, and Inngest credentials are configured.

## 6. Local API/database smoke test

With the dev server running:

```bash
npm run smoke:local
```

This exercises a temporary project, scene, prompt version, and generation-idempotency record against the local PostgreSQL database, verifies the records can be read, and deletes the temporary project afterward.

The smoke endpoint is disabled in production builds.

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

No Supabase-specific SDK is used by the application. Any compatible PostgreSQL provider can be used later by replacing `DATABASE_URL`, including Neon or another managed PostgreSQL service.

For a cloud database, normally remove `DATABASE_SSL=false` so TLS is required by `scripts/db-bootstrap.mjs` and the server database client.
