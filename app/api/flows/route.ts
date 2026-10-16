import { NextResponse } from "next/server";
import { refreshFlowBook } from "@/lib/flows/book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await refreshFlowBook();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
