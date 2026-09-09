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
  mime_type text,
  relative_path text,
  r2_key text,
  relay_delete_after timestamptz,
  relay_deleted_at timestamptz,
  veo_reference_refreshed_at timestamptz,
  sha256 text,
  file_size_bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

alter table assets add column if not exists mime_type text;
alter table assets add column if not exists relay_delete_after timestamptz;
alter table assets add column if not exists relay_deleted_at timestamptz;
alter table assets add column if not exists veo_reference_refreshed_at timestamptz;

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
  daily_generation_limit integer not null default 10,
  monthly_generation_limit integer not null default 100,
  daily_spend_limit_usd numeric(10,2) not null default 20.00,
  monthly_spend_limit_usd numeric(10,2) not null default 100.00,
  per_request_spend_limit_usd numeric(10,2) not null default 5.00,
  min_free_disk_bytes bigint not null default 32212254720,
  device_stale_after_seconds integer not null default 300,
  updated_at timestamptz not null default now()
);

alter table workspace_settings add column if not exists daily_generation_limit integer;
alter table workspace_settings add column if not exists monthly_generation_limit integer;
alter table workspace_settings add column if not exists daily_spend_limit_usd numeric(10,2);
alter table workspace_settings add column if not exists monthly_spend_limit_usd numeric(10,2);
alter table workspace_settings add column if not exists per_request_spend_limit_usd numeric(10,2);
alter table workspace_settings add column if not exists min_free_disk_bytes bigint;
alter table workspace_settings add column if not exists device_stale_after_seconds integer;
update workspace_settings
set daily_generation_limit = coalesce(daily_generation_limit, 10),
    monthly_generation_limit = coalesce(monthly_generation_limit, 100),
    daily_spend_limit_usd = coalesce(daily_spend_limit_usd, 20.00),
    monthly_spend_limit_usd = coalesce(monthly_spend_limit_usd, 100.00),
    per_request_spend_limit_usd = coalesce(per_request_spend_limit_usd, 5.00),
    min_free_disk_bytes = coalesce(min_free_disk_bytes, 32212254720),
    device_stale_after_seconds = coalesce(device_stale_after_seconds, 300);
alter table workspace_settings alter column daily_generation_limit set default 10;
alter table workspace_settings alter column daily_generation_limit set not null;
alter table workspace_settings alter column monthly_generation_limit set default 100;
alter table workspace_settings alter column monthly_generation_limit set not null;
alter table workspace_settings alter column daily_spend_limit_usd set default 20.00;
alter table workspace_settings alter column daily_spend_limit_usd set not null;
alter table workspace_settings alter column monthly_spend_limit_usd set default 100.00;
alter table workspace_settings alter column monthly_spend_limit_usd set not null;
alter table workspace_settings alter column per_request_spend_limit_usd set default 5.00;
alter table workspace_settings alter column per_request_spend_limit_usd set not null;
alter table workspace_settings alter column min_free_disk_bytes set default 32212254720;
alter table workspace_settings alter column min_free_disk_bytes set not null;
alter table workspace_settings alter column device_stale_after_seconds set default 300;
alter table workspace_settings alter column device_stale_after_seconds set not null;

create table if not exists agent_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id)
);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_threads(id) on delete cascade,
  role text not null,
  content text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists research_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  api_profile_id uuid references api_profiles(id) on delete set null,
  query text not null,
  mode text not null default 'search',
  summary text not null default '',
  search_queries jsonb,
  created_at timestamptz not null default now()
);

create table if not exists research_sources (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references research_sessions(id) on delete cascade,
  url text not null,
  title text,
  citation_start integer,
  citation_end integer,
  metadata jsonb,
  retrieved_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_request_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  scene_id uuid references scenes(id) on delete set null,
  requested_api_profile_id uuid references api_profiles(id),
  target_device_id uuid references devices(id),
  parent_generation_job_id uuid references generation_jobs(id) on delete set null,
  generation_mode text not null default 'generate',
  extension_depth integer not null default 0,
  expected_output_duration_seconds integer,
  model_id text not null,
  prompt_snapshot text not null default '',
  aspect_ratio_snapshot text not null default '9:16',
  duration_seconds_snapshot integer,
  resolution_snapshot text,
  estimated_cost_usd numeric(10,4),
  pricing_version text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, generation_request_id)
);

alter table generation_jobs add column if not exists prompt_snapshot text not null default '';
alter table generation_jobs add column if not exists aspect_ratio_snapshot text not null default '9:16';
alter table generation_jobs add column if not exists duration_seconds_snapshot integer;
alter table generation_jobs add column if not exists resolution_snapshot text;
alter table generation_jobs add column if not exists estimated_cost_usd numeric(10,4);
alter table generation_jobs add column if not exists pricing_version text;
alter table generation_jobs add column if not exists parent_generation_job_id uuid references generation_jobs(id) on delete set null;
alter table generation_jobs add column if not exists generation_mode text;
alter table generation_jobs add column if not exists extension_depth integer;
alter table generation_jobs add column if not exists expected_output_duration_seconds integer;
update generation_jobs
set generation_mode = coalesce(generation_mode, 'generate'),
    extension_depth = coalesce(extension_depth, 0),
    expected_output_duration_seconds = coalesce(expected_output_duration_seconds, duration_seconds_snapshot);
alter table generation_jobs alter column generation_mode set default 'generate';
alter table generation_jobs alter column generation_mode set not null;
alter table generation_jobs alter column extension_depth set default 0;
alter table generation_jobs alter column extension_depth set not null;

create table if not exists generation_job_assets (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid not null references generation_jobs(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete no action deferrable initially deferred,
  role text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(generation_job_id, role, sort_order)
);

alter table generation_job_assets drop constraint if exists generation_job_assets_asset_id_fkey;
alter table generation_job_assets
  add constraint generation_job_assets_asset_id_fkey
  foreign key (asset_id) references assets(id)
  on delete no action
  deferrable initially deferred;

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
create index if not exists idx_assets_relay_cleanup on assets(type, relay_delete_after) where relay_deleted_at is null;
create index if not exists idx_agent_messages_thread on agent_messages(thread_id, created_at);
create index if not exists idx_research_sessions_project on research_sessions(project_id, created_at desc);
create index if not exists idx_research_sources_session on research_sources(research_session_id);
create index if not exists idx_jobs_status on generation_jobs(status);
create index if not exists idx_jobs_cost_window on generation_jobs(workspace_id, created_at, estimated_cost_usd);
create index if not exists idx_jobs_parent on generation_jobs(parent_generation_job_id);
create index if not exists idx_job_assets_job on generation_job_assets(generation_job_id);
create index if not exists idx_attempts_job on generation_attempts(generation_job_id);
create index if not exists idx_attempts_started on generation_attempts(started_at);
create index if not exists idx_asset_locations_device on asset_locations(device_id);
