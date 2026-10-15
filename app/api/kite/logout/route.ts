import { NextResponse } from "next/server";
import { requireKiteConfig } from "@/lib/config";
import { createReadClient, invalidateKiteSession } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";
import { SESSION_COOKIE, destroyMemorySession, sessionFromRequest } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session) {
    try {
      const config = requireKiteConfig();
      await invalidateKiteSession(createReadClient(config.apiKey, session.accessToken));
    } catch (error) {
      console.error(`Kite logout failed: ${mapKiteError(error).code}`);
    }
    destroyMemorySession(session.id);
    forgetSnapshot(session.id);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
