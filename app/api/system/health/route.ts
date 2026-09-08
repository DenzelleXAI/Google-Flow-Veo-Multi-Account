import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/system-health";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const deep = searchParams.get("deep") === "1";
    const health = await getSystemHealth(deep);
    return NextResponse.json(health, { status: health.readyForPaidGeneration ? 200 : 503 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        readyForPaidGeneration: false,
        error: "System health check failed",
      },
      { status: 500 },
    );
  }
}
