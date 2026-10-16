import { NextResponse } from "next/server";
import { ensureDueReports } from "@/lib/report/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDueReports(new Date());
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report could not be saved.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
