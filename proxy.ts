import { NextRequest, NextResponse } from "next/server";
import {
  constantTimeTextEqual,
  OWNER_SESSION_COOKIE,
  ownerAuthConfigured,
  ownerAuthRequiredAtRuntime,
  verifyOwnerSessionToken,
} from "./lib/owner-auth";

function isPublicHumanPath(pathname: string) {
  return pathname === "/login" || pathname === "/api/auth/login";
}

function isInngestPath(pathname: string) {
  return pathname === "/api/inngest" || pathname.startsWith("/api/inngest/");
}

function isCompanionMachinePath(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/companion/")) return true;
  if (pathname === "/api/devices" && request.method === "POST") return true;
  if (/^\/api\/assets\/[^/]+\/locations$/.test(pathname) && request.method === "POST") return true;
  return false;
}

function hasValidCompanionToken(request: NextRequest) {
  const expected = process.env.COMPANION_TOKEN ?? "";
  const provided = request.headers.get("x-companion-token") ?? "";
  return Boolean(expected && provided && constantTimeTextEqual(provided, expected));
}

function unauthorizedApi(message: string, status = 401) {
  return NextResponse.json({ error: message }, { status });
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isPublicHumanPath(pathname) || isInngestPath(pathname)) {
    return NextResponse.next();
  }

  if (isCompanionMachinePath(request) && hasValidCompanionToken(request)) {
    return NextResponse.next();
  }

  // Local development remains frictionless when owner-auth variables are
  // intentionally absent. Production deployments always fail closed.
  if (!ownerAuthConfigured()) {
    if (!ownerAuthRequiredAtRuntime()) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return unauthorizedApi(
        "Owner authentication is not configured. Set APP_ACCESS_PASSWORD and APP_SESSION_SECRET.",
        503,
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("config", "missing");
    return NextResponse.redirect(loginUrl);
  }

  const session = request.cookies.get(OWNER_SESSION_COOKIE)?.value;
  if (await verifyOwnerSessionToken(session)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return unauthorizedApi("Owner session is required.");
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
