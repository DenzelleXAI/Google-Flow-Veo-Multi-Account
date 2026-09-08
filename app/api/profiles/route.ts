import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { createEncryptedGoogleProfile, getDefaultGoogleProfileId, listGoogleProfiles } from "@/lib/provider-profiles";

export async function GET() {
  if (!dbConfigured) return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });

  try {
    const [profiles, defaultProfileId] = await Promise.all([
      listGoogleProfiles(),
      getDefaultGoogleProfileId(),
    ]);
    return NextResponse.json({ profiles, defaultProfileId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!dbConfigured) return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });

  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!name || !apiKey) {
      return NextResponse.json({ error: "name and apiKey are required" }, { status: 400 });
    }

    const profile = await createEncryptedGoogleProfile(name, apiKey);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to create profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
