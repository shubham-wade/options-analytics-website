import { NextResponse } from "next/server";
import { patchStockFile, readStock, refreshStock, removeStock, StockError } from "@/lib/stocks/book";
import { compareSnapshots, parseComment, parseHighlight } from "@/lib/stocks/parse";
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

export async function DELETE(_request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  try {
    const removed = await removeStock(symbol);
    if (!removed) return NextResponse.json({ error: "This stock is not saved yet." }, { status: 404 });
    return NextResponse.json({ removed: symbol.toUpperCase() });
  } catch (error) {
    if (error instanceof StockError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await context.params;
  const patch: { highlight?: ReturnType<typeof parseHighlight>; comment?: string } = {};
  try {
    const body = (await request.json()) as { highlight?: unknown; comment?: unknown };
    const hasHighlight = Object.prototype.hasOwnProperty.call(body, "highlight");
    const hasComment = Object.prototype.hasOwnProperty.call(body, "comment");
    if (!hasHighlight && !hasComment) {
      return NextResponse.json({ error: "Send a highlight or a comment." }, { status: 400 });
    }
    if (hasHighlight) patch.highlight = parseHighlight(body.highlight);
    if (hasComment) patch.comment = parseComment(body.comment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send a highlight or a comment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    const file = await patchStockFile(symbol, patch);
    return NextResponse.json(withComparison(file));
  } catch (error) {
    if (error instanceof StockError) {
      const status = error.code === "invalid_symbol" ? 400 : 404;
      return NextResponse.json({ error: error.message }, { status });
    }
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
