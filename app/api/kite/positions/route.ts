import { NextResponse } from "next/server";
import { portfolioForRequest, toPublicPortfolio } from "@/lib/kite/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const includeFlat = new URL(request.url).searchParams.get("includeFlat") === "1";
  const result = await portfolioForRequest(request, includeFlat);
  if ("response" in result) return result.response;
  return NextResponse.json(toPublicPortfolio(result.snapshot), {
    headers: { "Cache-Control": "no-store" },
  });
}
