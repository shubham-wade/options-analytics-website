import { NextResponse } from "next/server";
import { ConfigError, requireKiteConfig } from "@/lib/config";
import { createLoginClient } from "@/lib/kite/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const config = requireKiteConfig();
    const loginUrl = createLoginClient(config.apiKey).getLoginURL();
    return NextResponse.redirect(loginUrl);
  } catch (error) {
    const code = error instanceof ConfigError ? "missing_config" : "exchange_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${code}`, request.url));
  }
}
