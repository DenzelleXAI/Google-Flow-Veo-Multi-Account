import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "@/lib/owner-auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set({
    name: OWNER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
