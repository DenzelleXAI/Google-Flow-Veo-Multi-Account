import { NextResponse } from "next/server";
import { testGoogleProfile } from "@/lib/provider-profiles";

export async function POST(
  _request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await context.params;
    const result = await testGoogleProfile(profileId);
    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Profile test failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
