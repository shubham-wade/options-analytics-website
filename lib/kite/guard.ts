import "server-only";
import { NextResponse } from "next/server";
import { kiteApiKey, requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { loadPortfolio, sharedInstrumentCache, toPublicPortfolio, type PortfolioSnapshot } from "@/lib/kite/portfolio";
import { forgetSnapshot, recentSnapshot, rememberSnapshot } from "@/lib/kite/snapshot-cache";
import { SESSION_COOKIE, destroyMemorySession, marketSessionFromRequest, requestDesk, sessionFromRequest, type StoredSession } from "@/lib/session/store";

export { toPublicPortfolio };

export function expiredResponse(clearCookie = true) {
  const response = NextResponse.json(
    {
      error: "Zerodha is not connected, or the server session was lost. Connect again.",
      code: "SESSION_EXPIRED",
    },
    { status: 401 },
  );
  if (clearCookie) {
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function portfolioForRequest(
  request: Request,
  includeFlat: boolean,
): Promise<{ session: StoredSession; snapshot: PortfolioSnapshot } | { response: NextResponse }> {
  const session = sessionFromRequest(request);
  if (!session) return { response: expiredResponse() };
  const cached = recentSnapshot(session.id, includeFlat);
  if (cached) return { session, snapshot: cached };
  try {
    requireKiteConfig();
    const market = marketSessionFromRequest(request) ?? session;
    const positions = asReader(createReadClient(kiteApiKey(session), session.accessToken));
    const separateQuotes = market.id !== session.id;
    const quotes = separateQuotes ? asReader(createReadClient(kiteApiKey(market), market.accessToken)) : positions;
    let snapshot: PortfolioSnapshot;
    try {
      snapshot = await loadPortfolio(positions, {
        includeFlat,
        cache: sharedInstrumentCache(),
        market: quotes,
      });
    } catch (error) {
      if (!separateQuotes || mapKiteError(error).code !== "SESSION_EXPIRED") throw error;
      destroyMemorySession(market.id);
      forgetSnapshot(market.id);
      snapshot = await loadPortfolio(positions, { includeFlat, cache: sharedInstrumentCache() });
    }
    rememberSnapshot(session.id, includeFlat, snapshot);
    return { session, snapshot };
  } catch (error) {
    const mapped = mapKiteError(error);
    console.error(`Kite read failed: ${mapped.code}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(session.id);
      forgetSnapshot(session.id);
      const others = requestDesk(request);
      return { response: expiredResponse(!others) };
    }
    return {
      response: NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus }),
    };
  }
}

