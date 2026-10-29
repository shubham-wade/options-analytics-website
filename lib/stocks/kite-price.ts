import "server-only";
import { kiteApiKey } from "@/lib/config";
import { asReader, createReadClient } from "@/lib/kite/client";
import { marketSessionFromRequest } from "@/lib/session/store";
import { round2 } from "@/lib/stocks/parse";
import type { StockPrice } from "@/lib/stocks/types";

/** Last traded price from the market login, when one is connected. Fundamentals stay on the company feed. */
export async function kitePrice(request: Request, symbol: string): Promise<StockPrice | null> {
  const session = marketSessionFromRequest(request);
  if (!session) return null;
  try {
    const reader = asReader(createReadClient(kiteApiKey(session), session.accessToken));
    const quotes = await reader.getQuote([`NSE:${symbol}`]);
    const quote = quotes[`NSE:${symbol}`];
    const last = quote?.last_price;
    if (last == null || !Number.isFinite(last)) return null;
    const change = quote?.net_change ?? null;
    const previous = quote?.ohlc?.close ?? (change != null ? last - change : null);
    const changePercent = change != null && previous ? (change / previous) * 100 : null;
    return {
      last: round2(last),
      change: round2(change),
      changePercent: round2(changePercent),
      open: round2(quote?.ohlc?.open ?? null),
      high: round2(quote?.ohlc?.high ?? null),
      low: round2(quote?.ohlc?.low ?? null),
      previousClose: round2(previous),
      volume: quote?.volume ?? null,
      average: round2(quote?.average_price ?? null),
      averageSource: quote?.average_price != null ? "kite" : null,
      yearHigh: null,
      yearLow: null,
      source: "kite",
    };
  } catch {
    return null;
  }
}
