import { NextResponse } from "next/server";
import { ConfigError, requireKiteConfig } from "@/lib/config";
import { exchangeRequestToken, validateKiteCallback } from "@/lib/kite/auth";
import { createLoginClient, generateKiteSession } from "@/lib/kite/client";
import { SESSION_COOKIE, createMemorySession } from "@/lib/session/store";

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

  let config;
  try {
    config = requireKiteConfig();
  } catch (error) {
    return fail(request, error instanceof ConfigError ? "missing_config" : "exchange_failed");
  }

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

  const { cookieValue } = createMemorySession({
    accessToken: exchanged.accessToken,
    userId: exchanged.userId,
    userName: exchanged.userName,
    userShortname: exchanged.userShortname,
    loginTime: exchanged.loginTime,
  });

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 30,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
