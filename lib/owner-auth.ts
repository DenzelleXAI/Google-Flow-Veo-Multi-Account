export const OWNER_SESSION_COOKIE = "persistent_studio_owner";
export const OWNER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const sessionMessage = "persistent-ai-video-studio-owner-session-v2";
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function signOwnerSession(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${sessionMessage}:${payload}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
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

export async function createOwnerSessionToken(
  secret = process.env.APP_SESSION_SECRET ?? "",
  nowMs = Date.now(),
) {
  if (!secret) throw new Error("APP_SESSION_SECRET is not configured.");

  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + OWNER_SESSION_MAX_AGE_SECONDS;
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const payload = `${issuedAt}.${expiresAt}.${nonce}`;
  const signature = await signOwnerSession(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyOwnerSessionToken(
  token: string | null | undefined,
  nowMs = Date.now(),
) {
  if (!token || !ownerAuthConfigured()) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [issuedAtText, expiresAtText, nonce, providedSignature] = parts;
  if (!/^\d+$/.test(issuedAtText) || !/^\d+$/.test(expiresAtText) || !/^[a-f0-9]{32}$/i.test(nonce)) {
    return false;
  }

  const issuedAt = Number(issuedAtText);
  const expiresAt = Number(expiresAtText);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt <= issuedAt) return false;
  if (expiresAt - issuedAt !== OWNER_SESSION_MAX_AGE_SECONDS) return false;
  if (issuedAt > now + 60) return false;
  if (expiresAt <= now) return false;

  const payload = `${issuedAtText}.${expiresAtText}.${nonce}`;
  const expected = await signOwnerSession(payload, process.env.APP_SESSION_SECRET ?? "");
  return constantTimeTextEqual(providedSignature, expected);
}

export function verifyOwnerPassword(password: string) {
  const expected = process.env.APP_ACCESS_PASSWORD ?? "";
  if (!expected || !ownerAuthConfigured()) return false;
  return constantTimeTextEqual(password, expected);
}

export function ownerAuthRequiredAtRuntime() {
  return process.env.NODE_ENV === "production";
}
