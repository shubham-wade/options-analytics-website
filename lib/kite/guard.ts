import "server-only";
import { NextResponse } from "next/server";
import { requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { loadPortfolio, sharedInstrumentCache, toPublicPortfolio, type PortfolioSnapshot } from "@/lib/kite/portfolio";
import { forgetSnapshot, recentSnapshot, rememberSnapshot } from "@/lib/kite/snapshot-cache";
import { SESSION_COOKIE, destroyMemorySession, sessionFromRequest, type StoredSession } from "@/lib/session/store";

export { toPublicPortfolio };

export function expiredResponse() {
  const response = NextResponse.json(
    {
      error: "Zerodha is not connected, or the server session was lost. Connect again.",
      code: "SESSION_EXPIRED",
    },
    { status: 401 },
  );
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
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
    const config = requireKiteConfig();
    const snapshot = await loadPortfolio(asReader(createReadClient(config.apiKey, session.accessToken)), {
      includeFlat,
      cache: sharedInstrumentCache(),
    });
    rememberSnapshot(session.id, includeFlat, snapshot);
    return { session, snapshot };
  } catch (error) {
    const mapped = mapKiteError(error);
    console.error(`Kite read failed: ${mapped.code}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(session.id);
      forgetSnapshot(session.id);
      return { response: expiredResponse() };
    }
    return {
      response: NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus }),
    };
  }
}

