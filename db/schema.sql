create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  platform text,
  media_root text,
  free_disk_bytes bigint,
  last_seen_at timestamptz,
  status text not null default 'offline',
  created_at timestamptz not null default now()
);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  aspect_ratio text not null default '9:16',
  duration_seconds integer,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scene_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  version integer not null,
  content text not null,
  created_by text not null default 'user',
  parent_version_id uuid references scene_prompt_versions(id),
  created_at timestamptz not null default now(),
  unique(scene_id, version)
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  filename text not null,
  relative_path text,
  r2_key text,
  sha256 text,
  file_size_bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create table if not exists asset_locations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  relative_path text,
  status text not null default 'missing',
  expected_hash text,
  verified_hash text,
  file_size_bytes bigint,
  verified_at timestamptz,
  last_seen_at timestamptz,
  unique(asset_id, device_id)
);

create table if not exists api_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  provider text not null default 'google',
  credential_source text not null default 'environment',
  encrypted_credential text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  default_api_profile_id uuid references api_profiles(id),
  default_target_device_id uuid references devices(id),
  daily_generation_limit integer,
  monthly_generation_limit integer,
  updated_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_request_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  scene_id uuid references scenes(id) on delete set null,
  requested_api_profile_id uuid references api_profiles(id),
  target_device_id uuid references devices(id),
  model_id text not null,
  prompt_snapshot text not null default '',
  aspect_ratio_snapshot text not null default '9:16',
  duration_seconds_snapshot integer,
  resolution_snapshot text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, generation_request_id)
);

-- Safe upgrades for databases bootstrapped before immutable generation snapshots existed.
alter table generation_jobs add column if not exists prompt_snapshot text not null default '';
alter table generation_jobs add column if not exists aspect_ratio_snapshot text not null default '9:16';
alter table generation_jobs add column if not exists duration_seconds_snapshot integer;
alter table generation_jobs add column if not exists resolution_snapshot text;

create table if not exists generation_attempts (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references generation_jobs(id) on delete cascade,
  api_profile_id uuid references api_profiles(id),
  provider text not null default 'google',
  model_id text not null,
  provider_operation_id text,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text
);

create table if not exists generation_outputs (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references generation_jobs(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(generation_job_id, asset_id)
);

create index if not exists idx_projects_workspace on projects(workspace_id);
create index if not exists idx_scenes_project on scenes(project_id);
create index if not exists idx_assets_project on assets(project_id);
create index if not exists idx_jobs_status on generation_jobs(status);
create index if not exists idx_attempts_job on generation_attempts(generation_job_id);
create index if not exists idx_asset_locations_device on asset_locations(device_id);
