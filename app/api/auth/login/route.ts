import { NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  ownerAuthConfigured,
  ownerAuthPartiallyConfigured,
  verifyOwnerPassword,
} from "@/lib/owner-auth";
import {
  checkOwnerLoginRateLimit,
  clearOwnerLoginFailures,
  recordOwnerLoginFailure,
} from "@/lib/owner-login-rate-limit";

function requestClientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .find(Boolean);
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function rateLimited(retryAfterSeconds: number) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    { error: "Too many failed login attempts. Try again later." },
    {
      status: 429,
      headers: { "retry-after": String(retryAfter) },
    },
  );
}

export async function POST(request: Request) {
  if (!ownerAuthConfigured()) {
    const detail = ownerAuthPartiallyConfigured()
      ? "APP_ACCESS_PASSWORD and APP_SESSION_SECRET must both be configured."
      : "Owner authentication is not configured on this deployment.";
    return NextResponse.json({ error: detail }, { status: 503 });
  }

  const clientAddress = requestClientAddress(request);
  const currentLimit = await checkOwnerLoginRateLimit(clientAddress);
  if (!currentLimit.allowed) return rateLimited(currentLimit.retryAfterSeconds);

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !verifyOwnerPassword(password)) {
    const afterFailure = await recordOwnerLoginFailure(clientAddress);
    if (!afterFailure.allowed) return rateLimited(afterFailure.retryAfterSeconds);
    return NextResponse.json({ error: "Invalid access password." }, { status: 401 });
  }

  await clearOwnerLoginFailures(clientAddress);
  const token = await createOwnerSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: OWNER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
