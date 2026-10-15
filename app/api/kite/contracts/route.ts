import { NextResponse } from "next/server";
import { ConfigError, requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { mapKiteError } from "@/lib/kite/errors";
import { expiredResponse } from "@/lib/kite/guard";
import { listNiftyOptions } from "@/lib/kite/lookup";
import { sharedInstrumentCache } from "@/lib/kite/portfolio";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";
import { destroyMemorySession, sessionFromRequest } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return expiredResponse();

  try {
    const config = requireKiteConfig();
    const contracts = await listNiftyOptions(
      asReader(createReadClient(config.apiKey, session.accessToken)),
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
      return expiredResponse();
    }
    return NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus });
  }
}
