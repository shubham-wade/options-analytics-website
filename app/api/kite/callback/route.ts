import { NextResponse } from "next/server";
import { readKiteAccount } from "@/lib/config";
import { exchangeRequestToken, validateKiteCallback } from "@/lib/kite/auth";
import { createLoginClient, generateKiteSession } from "@/lib/kite/client";
import { KITE_LOGIN_SLOT_COOKIE, SESSION_COOKIE, adoptLogin, createMemorySession, readCookieValue } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(request: Request, code: string) {
  return NextResponse.redirect(new URL(`/?auth_error=${code}`, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const validation = validateKiteCallback({
    request_token: url.searchParams.get("request_token"),
    status: url.searchParams.get("status"),
    action: url.searchParams.get("action"),
  });
  if (!validation.ok) return fail(request, validation.code);

  const slot = readCookieValue(request.headers.get("cookie"), KITE_LOGIN_SLOT_COOKIE) === "2" ? 2 : 1;
  const config = readKiteAccount(slot);
  if (!config) return fail(request, slot === 2 ? "missing_second" : "missing_config");

  const client = createLoginClient(config.apiKey);
  const exchanged = await exchangeRequestToken(
    {
      generateSession: (requestToken, apiSecret) => generateKiteSession(client, requestToken, apiSecret),
    },
    validation.requestToken,
    config.apiSecret,
  );
  if (!exchanged.ok) {
    console.error(`Kite session exchange failed: ${exchanged.code}`);
    return fail(request, exchanged.code);
  }

  const { session } = createMemorySession({
    accessToken: exchanged.accessToken,
    userId: exchanged.userId,
    userName: exchanged.userName,
    userShortname: exchanged.userShortname,
    loginTime: exchanged.loginTime,
    apiKey: config.apiKey,
    slot,
  });
  const adopted = adoptLogin(readCookieValue(request.headers.get("cookie"), SESSION_COOKIE), session);
  if ("error" in adopted) return fail(request, adopted.error);
  const { cookieValue } = adopted;

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 30,
  });
  response.cookies.set(KITE_LOGIN_SLOT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
