import { NextResponse } from "next/server";
import { ConfigError, kiteApiKey, requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { expiredResponse } from "@/lib/kite/guard";
import { listNiftyOptions } from "@/lib/kite/lookup";
import { sharedInstrumentCache } from "@/lib/kite/portfolio";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";
import { destroyMemorySession, marketSessionFromRequest, requestDesk, sessionFromRequest } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = marketSessionFromRequest(request) ?? sessionFromRequest(request);
  if (!session) return expiredResponse();

  try {
    requireKiteConfig();
    const contracts = await listNiftyOptions(
      asReader(createReadClient(kiteApiKey(session), session.accessToken)),
      sharedInstrumentCache(),
    );
    return NextResponse.json({ contracts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: "Zerodha credentials are not configured.", code: "BAD_REQUEST" }, { status: 500 });
    }
    const mapped = mapKiteError(error);
    console.error(`Kite contract list failed: ${mapped.code}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(session.id);
      forgetSnapshot(session.id);
      return expiredResponse(!requestDesk(request));
    }
    return NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus });
  }
}
