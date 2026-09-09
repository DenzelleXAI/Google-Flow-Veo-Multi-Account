export const OWNER_SESSION_COOKIE = "persistent_studio_owner";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const sessionMessage = "persistent-ai-video-studio-owner-session-v1";
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function ownerAuthConfigured() {
  return Boolean(process.env.APP_ACCESS_PASSWORD?.trim() && process.env.APP_SESSION_SECRET?.trim());
}

export function ownerAuthPartiallyConfigured() {
  const password = Boolean(process.env.APP_ACCESS_PASSWORD?.trim());
  const secret = Boolean(process.env.APP_SESSION_SECRET?.trim());
  return password !== secret;
}

export function constantTimeTextEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function createOwnerSessionToken(secret = process.env.APP_SESSION_SECRET ?? "") {
  if (!secret) throw new Error("APP_SESSION_SECRET is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(sessionMessage));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyOwnerSessionToken(token: string | null | undefined) {
  if (!token || !ownerAuthConfigured()) return false;
  const expected = await createOwnerSessionToken();
  return constantTimeTextEqual(token, expected);
}

export function verifyOwnerPassword(password: string) {
  const expected = process.env.APP_ACCESS_PASSWORD ?? "";
  if (!expected || !ownerAuthConfigured()) return false;
  return constantTimeTextEqual(password, expected);
}

export function ownerAuthRequiredAtRuntime() {
  return process.env.NODE_ENV === "production";
}
