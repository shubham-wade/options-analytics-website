import type { ScenarioPosition } from "@/lib/scenario/engine";
import { runScenarios, ScenarioInputError, type ScenarioResult } from "@/lib/scenario/engine";
import { assessQuote } from "@/lib/kite/quotes";
import { kiteDayPnl } from "@/lib/pricing/pnl";
import {
  extractNetPositions,
  findNearNiftyFuture,
  findNiftySpotInstrument,
  indexInstruments,
  quoteKey,
  selectNiftyOptionPositions,
} from "@/lib/kite/positions";
import type {
  KiteInstrument,
  KitePositionsResponse,
  KiteQuote,
  MappedOptionPosition,
  PremiumObservation,
  QuoteQuality,
} from "@/lib/kite/types";
import { DEFAULT_DIVIDEND_YIELD, DEFAULT_RISK_FREE_RATE, DEFAULT_SPOT_MOVES, timeToExpiryYears } from "@/lib/time";

export const NIFTY_SPOT_KEY = "NSE:NIFTY 50";
export const INDIA_VIX_KEY = "NSE:INDIA VIX";
const INSTRUMENT_TTL_MS = 6 * 60 * 60 * 1000;

export interface KiteReader {
  getPositions: () => Promise<KitePositionsResponse>;
  getInstruments: (exchange: "NFO" | "NSE") => Promise<KiteInstrument[]>;
  getQuote: (instruments: string[]) => Promise<Record<string, KiteQuote | undefined>>;
}

export interface InstrumentCache {
  get: (
    loader: (exchange: "NFO" | "NSE") => Promise<KiteInstrument[]>,
    now: number,
  ) => Promise<{ nfo: KiteInstrument[]; nse: KiteInstrument[]; fetchedAt: number; fromCache: boolean }>;
}

export function createInstrumentCache(ttlMs = INSTRUMENT_TTL_MS): InstrumentCache {
  let entry: { at: number; nfo: KiteInstrument[]; nse: KiteInstrument[] } | null = null;
  return {
    async get(loader, now) {
      if (entry && now - entry.at < ttlMs) {
        return { nfo: entry.nfo, nse: entry.nse, fetchedAt: entry.at, fromCache: true };
      }
      const [nfo, nse] = await Promise.all([loader("NFO"), loader("NSE")]);
      entry = { at: now, nfo, nse };
      return { nfo, nse, fetchedAt: now, fromCache: false };
    },
  };
}

const globalCache = globalThis as typeof globalThis & { __niftyInstrumentCache?: InstrumentCache };

export function sharedInstrumentCache(): InstrumentCache {
  if (!globalCache.__niftyInstrumentCache) {
    globalCache.__niftyInstrumentCache = createInstrumentCache();
  }
  return globalCache.__niftyInstrumentCache;
}

export interface PublicPosition extends MappedOptionPosition {
  quote: PremiumObservation;
  quoteKey: string;
}

export interface NiftyFutureQuote {
  symbol: string;
  price: number | null;
  /** Future last price minus the NIFTY 50 spot. */
  premium: number | null;
}

export interface IndiaVixQuote {
  price: number | null;
  change: number | null;
}

export type PublicPortfolio = Omit<PortfolioSnapshot, "scenarioInputs">;

export function toPublicPortfolio(snapshot: PortfolioSnapshot): PublicPortfolio {
  const { scenarioInputs: _scenarioInputs, ...rest } = snapshot;
  return rest;
}

export interface PortfolioSnapshot {
  fetchedAt: string;
  spot: {
    key: string;
    symbol: "NIFTY 50";
    price: number | null;
    /** Live level minus the previous close. Kite `net_change` is used when the close is missing. */
    change: number | null;
    quality: QuoteQuality;
    exchangeTimestamp: string | null;
    instrumentFound: boolean;
  };
  future: NiftyFutureQuote | null;
  vix: IndiaVixQuote;
  positions: PublicPosition[];
  flatCount: number;
  openCount: number;
  brokerUnrealised: number | null;
  brokerRealised: number | null;
  brokerPnl: number | null;
  brokerDayPnl: number | null;
  brokerDayPnlComplete: boolean;
  instrumentCacheFetchedAt: string;
  instrumentCacheHit: boolean;
  warnings: string[];
  scenarioInputs: ScenarioPosition[];
}

function spotDayChange(price: number | null, previousClose: number | null, netChange: number | null): number | null {
  if (price !== null && previousClose !== null) {
    const change = price - previousClose;
    return Number.isFinite(change) ? change : null;
  }
  return netChange;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function sumField(positions: PublicPosition[], field: "brokerUnrealised" | "brokerRealised" | "brokerPnl"): number | null {
  const values = positions.filter((position) => position.quantity !== 0).map((position) => position[field]);
  if (values.every((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function sumDayPnl(positions: PublicPosition[]): { total: number | null; complete: boolean } {
  if (positions.length === 0) return { total: 0, complete: true };
  const values = positions.map((position) => position.brokerDayPnl);
  if (values.every((value) => value === null)) return { total: null, complete: false };
  return {
    total: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    complete: values.every((value) => value !== null),
  };
}

export async function loadPortfolio(
  reader: KiteReader,
  options: { includeFlat: boolean; now?: Date; cache?: InstrumentCache },
): Promise<PortfolioSnapshot> {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const positionsResponse = await reader.getPositions();
  const net = extractNetPositions(positionsResponse);

  let instruments = new Map<string, KiteInstrument>();
  let nse: KiteInstrument[] = [];
  let cacheFetchedAt = now.getTime();
  let cacheHit = false;
  const cache = options.cache ?? createInstrumentCache();
  try {
    const cached = await cache.get((exchange) => reader.getInstruments(exchange), now.getTime());
    instruments = indexInstruments([...cached.nfo, ...cached.nse]);
    nse = cached.nse;
    cacheFetchedAt = cached.fetchedAt;
    cacheHit = cached.fromCache;
  } catch {
    warnings.push("The instrument master could not be loaded. Contract metadata will fall back to the trading symbol.");
  }

  const selected = selectNiftyOptionPositions(net, instruments, { includeFlat: true });
  const spotInstrument = findNiftySpotInstrument(nse);
  if (!spotInstrument) {
    warnings.push("NIFTY 50 was not found in the NSE instrument master. The documented quote key NSE:NIFTY 50 is still requested.");
  }

  const netById = new Map(net.map((position) => [`${position.exchange}:${position.tradingsymbol}:${position.product}`, position]));
  const futureInstrument = findNearNiftyFuture([...instruments.values()], now);
  const futureKey = futureInstrument ? quoteKey(futureInstrument.exchange, futureInstrument.tradingsymbol) : null;
  const keys = [NIFTY_SPOT_KEY, INDIA_VIX_KEY, ...selected.positions.map((position) => quoteKey(position.exchange, position.tradingSymbol))];
  if (futureKey) keys.push(futureKey);
  let quotes: Record<string, KiteQuote | undefined> = {};
  try {
    quotes = await reader.getQuote(keys);
  } catch (error) {
    warnings.push("Market quotes could not be loaded.");
    throw error;
  }

  const spotQuote = assessQuote(quotes[NIFTY_SPOT_KEY], now);
  const vixQuote = assessQuote(quotes[INDIA_VIX_KEY], now);
  const vix: IndiaVixQuote = {
    price: vixQuote.price,
    change: spotDayChange(vixQuote.price, vixQuote.previousClose, finiteNumber(quotes[INDIA_VIX_KEY]?.net_change)),
  };
  const futurePrice = futureKey ? assessQuote(quotes[futureKey], now).price : null;
  const future: NiftyFutureQuote | null = futureInstrument
    ? {
        symbol: futureInstrument.tradingsymbol,
        price: futurePrice,
        premium: futurePrice != null && spotQuote.price != null ? futurePrice - spotQuote.price : null,
      }
    : null;
  const priced: PublicPosition[] = selected.positions.map((position) => {
    const key = quoteKey(position.exchange, position.tradingSymbol);
    const quote = assessQuote(quotes[key], now);
    if (quote.quality === "unavailable" && position.quantity !== 0) {
      warnings.push(`${position.tradingSymbol} has no usable quote.`);
    }
    const source = netById.get(position.id);
    const multiplier = source && Number.isFinite(source.multiplier) && source.multiplier > 0 ? source.multiplier : position.multiplier;
    return {
      ...position,
      quote,
      quoteKey: key,
      brokerDayPnl: source
        ? kiteDayPnl({
            quantity: source.quantity,
            overnightQuantity: source.overnight_quantity,
            multiplier,
            closePrice: finiteNumber(source.close_price),
            dayBuyValue: finiteNumber(source.day_buy_value),
            daySellValue: finiteNumber(source.day_sell_value),
            markPrice: quote.ltp ?? finiteNumber(source.last_price),
          })
        : null,
      warnings: [...position.warnings, ...quote.warnings],
    };
  });
  const day = sumDayPnl(priced);
  const positions = options.includeFlat ? priced : priced.filter((position) => position.quantity !== 0);

  const scenarioInputs: ScenarioPosition[] = positions
    .filter((position) => position.quantity !== 0)
    .map((position) => ({
      id: position.id,
      tradingSymbol: position.tradingSymbol,
      right: position.optionType,
      strike: position.strike ?? Number.NaN,
      quantity: position.quantity,
      multiplier: position.multiplier,
      entryPremium: position.averagePrice,
      marketPremium: position.quote.price,
      timeYears:
        position.expiryEpochMs === null ? Number.NaN : timeToExpiryYears(position.expiryEpochMs, now.getTime(), 0),
    }));

  return {
    fetchedAt: now.toISOString(),
    spot: {
      key: NIFTY_SPOT_KEY,
      symbol: "NIFTY 50",
      price: spotQuote.price,
      change: spotDayChange(spotQuote.price, spotQuote.previousClose, finiteNumber(quotes[NIFTY_SPOT_KEY]?.net_change)),
      quality: spotQuote.quality,
      exchangeTimestamp: spotQuote.exchangeTimestamp,
      instrumentFound: Boolean(spotInstrument),
    },
    future,
    vix,
    positions,
    flatCount: selected.flatCount,
    openCount: positions.filter((position) => position.quantity !== 0).length,
    brokerUnrealised: sumField(positions, "brokerUnrealised"),
    brokerRealised: sumField(positions, "brokerRealised"),
    brokerPnl: sumField(positions, "brokerPnl"),
    brokerDayPnl: day.total,
    brokerDayPnlComplete: day.complete,
    instrumentCacheFetchedAt: new Date(cacheFetchedAt).toISOString(),
    instrumentCacheHit: cacheHit,
    warnings: [...warnings, ...spotQuote.warnings],
    scenarioInputs,
  };
}

export function valueSnapshot(
  snapshot: PortfolioSnapshot,
  request: {
    spot: number | null;
    moves: number[];
    horizonDays: number;
    ivMode: "constant" | "up" | "down";
    ivPoints: number;
    rate: number;
    dividendYield: number;
    excludeIds?: string[];
  },
): ScenarioResult {
  const baseSpot = request.spot && request.spot > 0 ? request.spot : snapshot.spot.price;
  if (!baseSpot) {
    throw new ScenarioInputError(
      "NIFTY spot is unavailable. Enter a starting spot or refresh while the quote is available.",
    );
  }
  const excluded = new Set(request.excludeIds ?? []);
  return runScenarios({
    baseSpot,
    moves: request.moves.length > 0 ? request.moves : [...DEFAULT_SPOT_MOVES],
    horizonDays: request.horizonDays,
    ivMode: request.ivMode,
    ivPoints: request.ivPoints,
    rate: request.rate,
    dividendYield: request.dividendYield,
    positions: snapshot.scenarioInputs.filter((position) => !excluded.has(position.id)),
  });
}

export const DEFAULT_SCENARIO = {
  moves: [...DEFAULT_SPOT_MOVES],
  horizonDays: 0,
  ivMode: "constant" as const,
  ivPoints: 0,
  rate: DEFAULT_RISK_FREE_RATE,
  dividendYield: DEFAULT_DIVIDEND_YIELD,
};
