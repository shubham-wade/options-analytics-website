import { NextResponse } from "next/server";
import { accountsForStatus, setActiveAccount, toPublicStatus } from "@/lib/session/store";
import { readKiteAccount, readKiteConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let accountId = "";
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || typeof (body as { accountId?: unknown }).accountId !== "string") {
      return NextResponse.json({ error: "Choose an account on this browser.", code: "BAD_REQUEST" }, { status: 400 });
    }
    accountId = (body as { accountId: string }).accountId;
  } catch {
    return NextResponse.json({ error: "Request could not be read.", code: "BAD_REQUEST" }, { status: 400 });
  }

  const resolved = setActiveAccount(request, accountId);
  if (!resolved) {
    return NextResponse.json({ error: "That account is not signed in on this browser.", code: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json(
    toPublicStatus(resolved.active, {
      configured: Boolean(readKiteConfig()),
      accounts: accountsForStatus(resolved),
      secondAccountConfigured: Boolean(readKiteAccount(2)),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
