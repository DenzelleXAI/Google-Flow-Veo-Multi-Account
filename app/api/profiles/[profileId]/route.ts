import { NextResponse } from "next/server";
import { setDefaultGoogleProfile, setGoogleProfileEnabled } from "@/lib/provider-profiles";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await context.params;
    const body = await request.json();

    if (typeof body.enabled === "boolean") {
      const profile = await setGoogleProfileEnabled(profileId, body.enabled);
      if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
      return NextResponse.json({ profile });
    }

    if (body.makeDefault === true) {
      await setDefaultGoogleProfile(profileId);
      return NextResponse.json({ defaultProfileId: profileId });
    }

    return NextResponse.json({ error: "No supported profile update provided" }, { status: 400 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Failed to update profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
