import { assessQuote } from "@/lib/kite/quotes";
import {
  indexInstruments,
  parseNiftyOptionSymbol,
  findNearNiftyFuture,
  quoteKey,
  readInstrumentExpiry,
} from "@/lib/kite/positions";
import { INDIA_VIX_KEY, NIFTY_SPOT_KEY, type IndiaVixQuote, type InstrumentCache, type KiteReader, type NiftyFutureQuote } from "@/lib/kite/portfolio";
import type { KiteInstrument, KiteQuote, QuoteQuality } from "@/lib/kite/types";

export interface ManualContractQuote {
  symbol: string;
  found: boolean;
  expiry: string | null;
  lotSize: number | null;
  price: number | null;
  /** Last traded price from the live quote. */
  ltp: number | null;
  previousClose: number | null;
  source: "mid" | "ltp" | "none";
  quality: QuoteQuality;
  warnings: string[];
}

export interface ManualLookup {
  spot: { price: number | null; change: number | null; quality: QuoteQuality };
  vix: IndiaVixQuote;
  contracts: ManualContractQuote[];
  future: NiftyFutureQuote | null;
  warnings: string[];
  fetchedAt: string;
}

export async function lookupContracts(
  reader: KiteReader,
  symbols: string[],
  cache: InstrumentCache,
  now = new Date(),
): Promise<ManualLookup> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 40);
  const warnings: string[] = [];
  let instruments = new Map<string, KiteInstrument>();
  try {
    const cached = await cache.get((exchange) => reader.getInstruments(exchange), now.getTime());
    instruments = indexInstruments([...cached.nfo, ...cached.nse]);
  } catch {
    warnings.push("The instrument master could not be loaded.");
  }

  const futureInstrument = findNearNiftyFuture([...instruments.values()], now);
  const futureKey = futureInstrument ? quoteKey(futureInstrument.exchange, futureInstrument.tradingsymbol) : null;
  const keys = [NIFTY_SPOT_KEY, INDIA_VIX_KEY];
  if (futureKey) keys.push(futureKey);
  for (const symbol of unique) {
    if (parseNiftyOptionSymbol(symbol)) keys.push(quoteKey("NFO", symbol));
  }

  const quotes = await reader.getQuote(keys);
  const spot = indexPrint(quotes[NIFTY_SPOT_KEY], now);
  const vixQuote = indexPrint(quotes[INDIA_VIX_KEY], now);
  if (spot.price === null) warnings.push("NIFTY 50 quote was not available.");
  const futurePrice = futureKey ? assessQuote(quotes[futureKey], now).price : null;
  const future: NiftyFutureQuote | null = futureInstrument
    ? {
        symbol: futureInstrument.tradingsymbol,
        price: futurePrice,
        premium: futurePrice != null && spot.price != null ? futurePrice - spot.price : null,
      }
    : null;

  const contracts = unique.map((symbol) => {
    const parsed = parseNiftyOptionSymbol(symbol);
    if (!parsed) {
      return {
        symbol,
        found: false,
        expiry: null,
        lotSize: null,
        price: null,
        ltp: null,
        previousClose: null,
        source: "none" as const,
        quality: "unavailable" as const,
        warnings: ["This is not a NIFTY option symbol."],
      };
    }
    const instrument = instruments.get(quoteKey("NFO", symbol));
    const expiryDate = instrument ? readInstrumentExpiry(instrument.expiry) : parsed.expiry;
    const lot = Number(instrument?.lot_size);
    const quote = assessQuote(quotes[quoteKey("NFO", symbol)], now);
    return {
      symbol,
      found: Boolean(instrument),
      expiry: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
      lotSize: Number.isFinite(lot) && lot > 0 ? lot : null,
      price: quote.price,
      ltp: quote.ltp,
      previousClose: quote.previousClose,
      source: quote.source,
      quality: quote.quality,
      warnings: quote.warnings,
    };
  });

  return {
    spot: {
      price: spot.price,
      change: spot.change,
      quality: spot.quality,
    },
    vix: {
      price: vixQuote.price,
      change: vixQuote.change,
    },
    contracts,
    future,
    warnings,
    fetchedAt: now.toISOString(),
  };
}

/** Index quotes use the last price. A bid-ask mid on NIFTY 50 or India VIX is not the index print. */
function indexPrint(quote: KiteQuote | undefined, now: Date): { price: number | null; change: number | null; quality: QuoteQuality } {
  const assessed = assessQuote(quote, now);
  const price = assessed.ltp ?? assessed.price;
  return {
    price,
    change: spotChange(price, assessed.previousClose, finiteNumber(quote?.net_change)),
    quality: assessed.quality,
  };
}

function spotChange(price: number | null, previousClose: number | null, netChange: number | null): number | null {
  if (price !== null && previousClose !== null) {
    const change = price - previousClose;
    return Number.isFinite(change) ? change : null;
  }
  return netChange;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ListedNiftyOption {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  lotSize: number | null;
}

export async function listNiftyOptions(reader: KiteReader, cache: InstrumentCache): Promise<ListedNiftyOption[]> {
  const cached = await cache.get((exchange) => reader.getInstruments(exchange), Date.now());
  const listed: ListedNiftyOption[] = [];
  for (const instrument of cached.nfo) {
    if (instrument.exchange !== "NFO" || instrument.name !== "NIFTY") continue;
    if (instrument.instrument_type !== "CE" && instrument.instrument_type !== "PE") continue;
    const expiryDate = readInstrumentExpiry(instrument.expiry);
    const strike = Number(instrument.strike);
    if (!expiryDate || !Number.isFinite(strike) || strike <= 0 || !instrument.tradingsymbol) continue;
    const lot = Number(instrument.lot_size);
    listed.push({
      symbol: instrument.tradingsymbol,
      expiry: expiryDate.toISOString().slice(0, 10),
      strike,
      optionType: instrument.instrument_type,
      lotSize: Number.isFinite(lot) && lot > 0 ? lot : null,
    });
  }
  listed.sort((left, right) => {
    if (left.expiry !== right.expiry) return left.expiry < right.expiry ? -1 : 1;
    if (left.strike !== right.strike) return left.strike - right.strike;
    return left.optionType === right.optionType ? 0 : left.optionType === "CE" ? -1 : 1;
  });
  return listed;
}
