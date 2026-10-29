import { NextResponse } from "next/server";
import { loadPaperDesk, paperBuy, paperSell } from "@/lib/paper/book";
import { PaperError } from "@/lib/paper/lots";
import { StockError } from "@/lib/stocks/book";

export const dynamic = "force-dynamic";

function errorStatus(error: PaperError | StockError): number {
  if (error instanceof StockError) {
    if (error.code === "invalid_symbol") return 400;
    if (error.code === "not_found") return 404;
    return 502;
  }
  if (error.code === "not_found") return 404;
  if (error.code === "quote") return 502;
  return 400;
}

export async function GET() {
  const desk = await loadPaperDesk();
  return NextResponse.json(desk);
}

export async function POST(request: Request) {
  let body: { action?: string; symbol?: string; quantity?: number; price?: number | null; id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send a paper buy or sell." }, { status: 400 });
  }
  try {
    if (body.action === "buy") {
      const price = body.price == null ? null : Number(body.price);
      const desk = await paperBuy(body.symbol ?? "", Number(body.quantity), price);
      return NextResponse.json(desk);
    }
    if (body.action === "sell") {
      const desk = await paperSell(body.id ?? "");
      return NextResponse.json(desk);
    }
    return NextResponse.json({ error: "Send a paper buy or sell." }, { status: 400 });
  } catch (error) {
    if (error instanceof PaperError || error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: errorStatus(error) });
    }
    throw error;
  }
}
