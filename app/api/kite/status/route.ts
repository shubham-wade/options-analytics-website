import { NextResponse } from "next/server";
import { readKiteAccount, readKiteConfig } from "@/lib/config";
import {
  SESSION_COOKIE,
  accountsForStatus,
  getSessionSecret,
  readCookieValue,
  requestDesk,
  toPublicStatus,
  verifySessionCookie,
} from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = getSessionSecret();
  const raw = readCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const sessionId = raw ? verifySessionCookie(raw, secret.secret) : null;
  const resolved = requestDesk(request);
  const session = resolved?.active ?? null;
  return NextResponse.json(
    toPublicStatus(session, {
      configured: Boolean(readKiteConfig()),
      expired: Boolean(sessionId && !session),
      accounts: accountsForStatus(resolved),
      secondAccountConfigured: Boolean(readKiteAccount(2)),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
