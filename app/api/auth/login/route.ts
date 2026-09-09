import { NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
  ownerAuthConfigured,
  ownerAuthPartiallyConfigured,
  verifyOwnerPassword,
} from "@/lib/owner-auth";

export async function POST(request: Request) {
  if (!ownerAuthConfigured()) {
    const detail = ownerAuthPartiallyConfigured()
      ? "APP_ACCESS_PASSWORD and APP_SESSION_SECRET must both be configured."
      : "Owner authentication is not configured on this deployment.";
    return NextResponse.json({ error: detail }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !verifyOwnerPassword(password)) {
    return NextResponse.json({ error: "Invalid access password." }, { status: 401 });
  }

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
