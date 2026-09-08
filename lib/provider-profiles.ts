import { requireDb } from "./db";
import { ensurePersonalWorkspace } from "./workspace";

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

  if (existing[0]) return existing[0];

  const rows = await sql`
    insert into api_profiles (workspace_id, name, provider, credential_source, enabled)
    values (${workspace.id}, 'Default Google Profile', 'google', 'environment', true)
    returning *
  `;
  return rows[0];
}

export async function resolveGoogleProfile(requestedProfileId?: string | null) {
  const sql = requireDb();
  let profile;

  if (requestedProfileId) {
    const rows = await sql`
      select * from api_profiles
      where id = ${requestedProfileId} and provider = 'google' and enabled = true
      limit 1
    `;
    profile = rows[0];
  } else {
    profile = await ensureEnvironmentGoogleProfile();
  }

  if (!profile) throw new Error('No enabled Google API profile is available.');

  if (profile.credential_source === 'environment') {
    const apiKey = process.env.GOOGLE_AUTH_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Google auth key is not configured on the server.');
    return { profile, apiKey };
  }

  throw new Error('Encrypted user-managed API profiles are not enabled until Phase 3.');
}
