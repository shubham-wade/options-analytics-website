import { NextResponse } from "next/server";
import { readKiteConfig } from "@/lib/config";
import {
  SESSION_COOKIE,
  getSessionSecret,
  readCookieValue,
  sessionFromRequest,
  toPublicStatus,
  verifySessionCookie,
} from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = getSessionSecret();
  const raw = readCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const sessionId = raw ? verifySessionCookie(raw, secret.secret) : null;
  const session = sessionFromRequest(request);
  return NextResponse.json(
    toPublicStatus(session, {
      configured: Boolean(readKiteConfig()),
      expired: Boolean(sessionId && !session),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
