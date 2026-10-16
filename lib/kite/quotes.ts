import type { KiteQuote, PremiumObservation, QuoteQuality } from "@/lib/kite/types";
import { isNseRegularSession, parseKiteTimestamp } from "@/lib/time";

const LIVE_MS = 20_000;
const DELAYED_MS = 120_000;
const STALE_TRADE_MS = 10 * 60_000;

function positive(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function assessQuote(quote: KiteQuote | undefined, now: Date): PremiumObservation {
  if (!quote) {
    return {
      price: null,
      source: "none",
      quality: "unavailable",
      bid: null,
      ask: null,
      ltp: null,
      previousClose: null,
      exchangeTimestamp: null,
      lastTradeTime: null,
      warnings: ["Kite did not return a quote for this instrument."],
    };
  }

  const warnings: string[] = [];
  const bid = positive(quote.depth?.buy?.[0]?.price);
  const ask = positive(quote.depth?.sell?.[0]?.price);
  const ltp = positive(quote.last_price);
  const exchangeTime = parseKiteTimestamp(quote.timestamp);
  const lastTrade = parseKiteTimestamp(quote.last_trade_time);
  const sessionOpen = isNseRegularSession(now);

  let quality: QuoteQuality;
  if (!sessionOpen) {
    quality = ltp || (bid && ask) ? "market-closed" : "unavailable";
    if (quality === "market-closed") {
      warnings.push("The regular NSE session is closed, so this is the last available snapshot.");
    }
  } else if (!exchangeTime) {
    quality = "stale";
    warnings.push("The quote has no exchange timestamp, so freshness cannot be verified.");
  } else {
    const age = now.getTime() - exchangeTime.getTime();
    if (age <= LIVE_MS) quality = "live";
    else if (age <= DELAYED_MS) {
      quality = "delayed";
      warnings.push("The exchange timestamp is more than 20 seconds old.");
    } else {
      quality = "stale";
      warnings.push("The exchange timestamp is more than two minutes old.");
    }
  }

  const depthPresent = (quote.depth?.buy?.length ?? 0) > 0 || (quote.depth?.sell?.length ?? 0) > 0;
  let price: number | null = null;
  let source: PremiumObservation["source"] = "none";
  if (bid !== null && ask !== null && ask >= bid) {
    price = (bid + ask) / 2;
    source = "mid";
    const mid = price;
    if (mid > 0 && (ask - bid) / mid > 0.2) {
      warnings.push("The bid-ask spread is wider than 20% of the midpoint.");
    }
  } else if (ltp !== null) {
    price = ltp;
    source = "ltp";
    if (depthPresent) {
      warnings.push("Bid and ask were not both valid, so the last traded price was used.");
    }
    if (sessionOpen && lastTrade && now.getTime() - lastTrade.getTime() > STALE_TRADE_MS) {
      warnings.push("The last trade is more than 10 minutes old.");
      if (quality === "live" || quality === "delayed") quality = "stale";
    }
  } else {
    quality = "unavailable";
    warnings.push("The quote has no usable bid, ask or last price.");
  }

  return {
    price,
    source,
    quality,
    bid,
    ask,
    ltp,
    previousClose: positive(quote.ohlc?.close),
    exchangeTimestamp: exchangeTime ? exchangeTime.toISOString() : null,
    lastTradeTime: lastTrade ? lastTrade.toISOString() : null,
    warnings,
  };
}
