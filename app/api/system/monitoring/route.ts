import { NextResponse } from "next/server";
import { getOperationsSnapshot } from "@/lib/operations-monitoring";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getOperationsSnapshot(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load operations monitoring snapshot", error);
    return NextResponse.json({ error: "Failed to load operations monitoring" }, { status: 500 });
  }
}
