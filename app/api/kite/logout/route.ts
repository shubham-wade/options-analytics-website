import { NextResponse } from "next/server";
import { kiteApiKey, requireKiteConfig } from "@/lib/config";
import { createReadClient, invalidateKiteSession } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";
import { SESSION_COOKIE, removeActiveAccount, sessionFromRequest } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session) {
    try {
      requireKiteConfig();
      await invalidateKiteSession(createReadClient(kiteApiKey(session), session.accessToken));
    } catch (error) {
      console.error(`Kite logout failed: ${mapKiteError(error).code}`);
    }
    forgetSnapshot(session.id);
  }
  const { remaining } = removeActiveAccount(request);
  const response = NextResponse.json({ ok: true });
  if (!remaining) {
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
