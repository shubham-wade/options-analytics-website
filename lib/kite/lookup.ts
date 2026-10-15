import { assessQuote } from "@/lib/kite/quotes";
import {
  indexInstruments,
  parseNiftyOptionSymbol,
  quoteKey,
  readInstrumentExpiry,
} from "@/lib/kite/positions";
import { NIFTY_SPOT_KEY, type InstrumentCache, type KiteReader } from "@/lib/kite/portfolio";
import type { KiteInstrument, QuoteQuality } from "@/lib/kite/types";

export interface ManualContractQuote {
  symbol: string;
  found: boolean;
  expiry: string | null;
  lotSize: number | null;
  price: number | null;
  source: "mid" | "ltp" | "none";
  quality: QuoteQuality;
  warnings: string[];
}

export interface ManualLookup {
  spot: { price: number | null; quality: QuoteQuality };
  contracts: ManualContractQuote[];
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

  const keys = [NIFTY_SPOT_KEY];
  for (const symbol of unique) {
    if (parseNiftyOptionSymbol(symbol)) keys.push(quoteKey("NFO", symbol));
  }

  const quotes = await reader.getQuote(keys);
  const spot = assessQuote(quotes[NIFTY_SPOT_KEY], now);
  if (spot.price === null) warnings.push("NIFTY 50 quote was not available.");

  const contracts = unique.map((symbol) => {
    const parsed = parseNiftyOptionSymbol(symbol);
    if (!parsed) {
      return {
        symbol,
        found: false,
        expiry: null,
        lotSize: null,
        price: null,
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
      source: quote.source,
      quality: quote.quality,
      warnings: quote.warnings,
    };
  });

  return {
    spot: { price: spot.price, quality: spot.quality },
    contracts,
    warnings,
    fetchedAt: now.toISOString(),
  };
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
