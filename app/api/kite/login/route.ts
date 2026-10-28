import { NextResponse } from "next/server";
import { ConfigError, readKiteAccount } from "@/lib/config";
import { createLoginClient } from "@/lib/kite/client";
import { KITE_LOGIN_SLOT_COOKIE } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const slot = new URL(request.url).searchParams.get("account") === "2" ? 2 : 1;
  try {
    const config = readKiteAccount(slot);
    if (!config) {
      const code = slot === 2 ? "missing_second" : "missing_config";
      return NextResponse.redirect(new URL(`/?auth_error=${code}`, request.url));
    }
    const loginUrl = createLoginClient(config.apiKey).getLoginURL();
    const response = NextResponse.redirect(loginUrl);
    response.cookies.set(KITE_LOGIN_SLOT_COOKIE, String(slot), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  } catch (error) {
    const code = error instanceof ConfigError ? "missing_config" : "exchange_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${code}`, request.url));
  }
}
