import { NextResponse } from "next/server";
import { ConfigError, kiteApiKey, requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { expiredResponse } from "@/lib/kite/guard";
import { lookupContracts } from "@/lib/kite/lookup";
import { sharedInstrumentCache } from "@/lib/kite/portfolio";
import { destroyMemorySession, marketSessionFromRequest, requestDesk, sessionFromRequest } from "@/lib/session/store";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let symbols: string[] = [];
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { symbols?: unknown }).symbols)) {
      return NextResponse.json({ error: "symbols must be an array.", code: "BAD_REQUEST" }, { status: 400 });
    }
    const raw = (body as { symbols: unknown[] }).symbols;
    if (raw.length > 40 || raw.some((symbol) => typeof symbol !== "string" || symbol.length > 40)) {
      return NextResponse.json({ error: "Send at most 40 contract symbols.", code: "BAD_REQUEST" }, { status: 400 });
    }
    symbols = raw as string[];
  } catch {
    return NextResponse.json({ error: "Request could not be read.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const market = marketSessionFromRequest(request);
  const active = sessionFromRequest(request);
  const session = market ?? active;
  if (!session) return expiredResponse();
  let quoting = session;

  try {
    requireKiteConfig();
    let lookup;
    try {
      lookup = await lookupContracts(readerFor(quoting), symbols, sharedInstrumentCache());
    } catch (error) {
      if (!market || !active || market.id === active.id || mapKiteError(error).code !== "SESSION_EXPIRED") throw error;
      destroyMemorySession(market.id);
      forgetSnapshot(market.id);
      quoting = active;
      lookup = await lookupContracts(readerFor(quoting), symbols, sharedInstrumentCache());
    }
    return NextResponse.json(lookup, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: "Zerodha credentials are not configured.", code: "BAD_REQUEST" }, { status: 500 });
    }
    const mapped = mapKiteError(error);
    console.error(`Kite lookup failed: ${mapped.code}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(quoting.id);
      forgetSnapshot(quoting.id);
      return expiredResponse(!requestDesk(request));
    }
    return NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus });
  }
}

function readerFor(session: { apiKey?: string; accessToken: string }) {
  return asReader(createReadClient(kiteApiKey(session), session.accessToken));
}
