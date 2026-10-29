import { NextResponse } from "next/server";
import { listStocks, refreshStock, StockError } from "@/lib/stocks/book";
import { compareSnapshots } from "@/lib/stocks/parse";
import { kitePrice } from "@/lib/stocks/kite-price";

export const dynamic = "force-dynamic";

export async function GET() {
  const stocks = await listStocks();
  return NextResponse.json({ stocks });
}

export async function POST(request: Request) {
  let symbol = "";
  try {
    const body = (await request.json()) as { symbol?: string };
    symbol = body.symbol ?? "";
  } catch {
    return NextResponse.json({ error: "Send the NSE symbol." }, { status: 400 });
  }
  try {
    const file = await refreshStock(symbol, new Date(), await kitePrice(request, symbol));
    const older = file.snapshots.length > 1 ? file.snapshots[file.snapshots.length - 2] : null;
    const newer = file.snapshots[file.snapshots.length - 1];
    return NextResponse.json({
      file,
      versusPrevious: older && older.date !== newer.date ? compareSnapshots(older, newer) : [],
    });
  } catch (error) {
    if (error instanceof StockError) {
      const status = error.code === "invalid_symbol" ? 400 : error.code === "not_found" ? 404 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
