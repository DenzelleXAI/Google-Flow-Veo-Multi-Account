import { GoogleGenAI } from "@google/genai";
import { decryptCredential, encryptCredential } from "./credential-crypto";
import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

export type ApiProfileRecord = {
  id: string;
  workspace_id: string;
  name: string;
  provider: string;
  credential_source: "environment" | "encrypted";
  enabled: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export async function ensureEnvironmentGoogleProfile() {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();

  const existing = await sql`
    select * from api_profiles
    where workspace_id = ${workspace.id}
      and provider = 'google'
      and credential_source = 'environment'
    order by created_at asc
    limit 1
  `;

  if (existing[0]) return existing[0] as unknown as ApiProfileRecord;

  const rows = await sql`
    insert into api_profiles (workspace_id, name, provider, credential_source, enabled)
    values (${workspace.id}, 'Default Google Profile', 'google', 'environment', true)
    returning *
  `;
  return rows[0] as unknown as ApiProfileRecord;
}

export async function listGoogleProfiles() {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  await ensureEnvironmentGoogleProfile();

  const rows = await sql`
    select id, workspace_id, name, provider, credential_source, enabled, created_at, updated_at
    from api_profiles
    where workspace_id = ${workspace.id} and provider = 'google'
    order by credential_source = 'environment' desc, created_at asc
  `;
  return Array.from(rows) as unknown as ApiProfileRecord[];
}

export async function createEncryptedGoogleProfile(name: string, apiKey: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const encrypted = encryptCredential(apiKey.trim());

  const rows = await sql`
    insert into api_profiles (
      workspace_id, name, provider, credential_source, encrypted_credential, enabled
    ) values (
      ${workspace.id}, ${name}, 'google', 'encrypted', ${encrypted}, true
    )
    returning id, workspace_id, name, provider, credential_source, enabled, created_at, updated_at
  `;
  return rows[0] as unknown as ApiProfileRecord;
}

export async function setGoogleProfileEnabled(profileId: string, enabled: boolean) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    update api_profiles
    set enabled = ${enabled}, updated_at = now()
    where id = ${profileId}
      and workspace_id = ${workspace.id}
      and provider = 'google'
    returning id, workspace_id, name, provider, credential_source, enabled, created_at, updated_at
  `;
  return (rows[0] as unknown as ApiProfileRecord | undefined) ?? null;
}

export async function setDefaultGoogleProfile(profileId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const profiles = await sql`
    select id from api_profiles
    where id = ${profileId}
      and workspace_id = ${workspace.id}
      and provider = 'google'
      and enabled = true
    limit 1
  `;
  if (!profiles[0]) throw new Error("Selected profile is not enabled or does not exist.");

  await sql`
    insert into workspace_settings (workspace_id, default_api_profile_id)
    values (${workspace.id}, ${profileId})
    on conflict (workspace_id) do update
      set default_api_profile_id = excluded.default_api_profile_id,
          updated_at = now()
  `;

  return profileId;
}

export async function getDefaultGoogleProfileId() {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select default_api_profile_id
    from workspace_settings
    where workspace_id = ${workspace.id}
    limit 1
  `;
  return (rows[0]?.default_api_profile_id as string | null | undefined) ?? null;
}

async function loadProfile(profileId: string) {
  const sql = requireDb();
  const workspace = await ensurePersonalWorkspace();
  const rows = await sql`
    select * from api_profiles
    where id = ${profileId}
      and workspace_id = ${workspace.id}
      and provider = 'google'
      and enabled = true
    limit 1
  `;
  return rows[0] ?? null;
}

export async function resolveGoogleProfile(requestedProfileId?: string | null) {
  const sql = requireDb();
  let profile: any = null;

  if (requestedProfileId) {
    profile = await loadProfile(requestedProfileId);
  } else {
    const defaultId = await getDefaultGoogleProfileId();
    if (defaultId) profile = await loadProfile(defaultId);
    if (!profile) profile = await ensureEnvironmentGoogleProfile();
  }

  if (!profile) throw new Error("No enabled Google API profile is available.");

  if (profile.credential_source === "environment") {
    const apiKey = process.env.GOOGLE_AUTH_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Google auth key is not configured on the server.");
    return { profile: profile as ApiProfileRecord, apiKey };
  }

  if (profile.credential_source === "encrypted") {
    if (!profile.encrypted_credential) throw new Error("Profile credential is missing.");
    return { profile: profile as ApiProfileRecord, apiKey: decryptCredential(profile.encrypted_credential) };
  }

  throw new Error("Unsupported Google credential source.");
}

export async function testGoogleProfile(profileId: string) {
  const resolved = await resolveGoogleProfile(profileId);
  const ai = new GoogleGenAI({ apiKey: resolved.apiKey });
  const pager = await ai.models.list({ config: { pageSize: 1 } });
  for await (const model of pager) {
    return { ok: true, model: model.name ?? null };
  }
  return { ok: true, model: null };
}
