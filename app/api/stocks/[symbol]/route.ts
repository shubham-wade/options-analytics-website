import { NextResponse } from "next/server";
import { readStock, refreshStock, StockError } from "@/lib/stocks/book";
import { compareSnapshots } from "@/lib/stocks/parse";
import { kitePrice } from "@/lib/stocks/kite-price";
import type { StockFile } from "@/lib/stocks/types";

export const dynamic = "force-dynamic";

function withComparison(file: StockFile) {
  const newer = file.snapshots[file.snapshots.length - 1] ?? null;
  const older = file.snapshots.length > 1 ? file.snapshots[file.snapshots.length - 2] : null;
  return {
    file,
    versusPrevious: older && newer && older.date !== newer.date ? compareSnapshots(older, newer) : [],
  };
}

export async function GET(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  try {
    const file = await readStock(symbol);
    if (!file) return NextResponse.json({ error: "This stock is not saved yet." }, { status: 404 });
    return NextResponse.json(withComparison(file));
  } catch (error) {
    if (error instanceof StockError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function POST(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  try {
    const file = await refreshStock(symbol, new Date(), await kitePrice(request, symbol));
    return NextResponse.json(withComparison(file));
  } catch (error) {
    if (error instanceof StockError) {
      const status = error.code === "invalid_symbol" ? 400 : error.code === "not_found" ? 404 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
