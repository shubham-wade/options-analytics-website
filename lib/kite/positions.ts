import type { KiteInstrument, KiteNetPosition, MappedOptionPosition, ParsedNiftyOption } from "@/lib/kite/types";
import { niftySettlementInstant } from "@/lib/time";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const WEEK_MONTH: Record<string, number> = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
  "7": 6,
  "8": 7,
  "9": 8,
  O: 9,
  N: 10,
  D: 11,
};

export function quoteKey(exchange: string, tradingSymbol: string): string {
  return `${exchange}:${tradingSymbol}`;
}

export function extractNetPositions(response: { net?: KiteNetPosition[] | null; day?: KiteNetPosition[] | null }): KiteNetPosition[] {
  if (!response || !Array.isArray(response.net)) {
    throw new Error("Kite positions response is missing the net array");
  }
  return response.net;
}

export function parseNiftyOptionSymbol(symbol: string): ParsedNiftyOption | null {
  if (!symbol.startsWith("NIFTY")) return null;
  const rest = symbol.slice("NIFTY".length);
  if (!/^\d/.test(rest)) return null;

  const monthly = /^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+(?:\.\d+)?)(CE|PE)$/.exec(rest);
  if (monthly) {
    const year = 2000 + Number(monthly[1]);
    const month = MONTHS.indexOf(monthly[2] as (typeof MONTHS)[number]);
    const strike = Number(monthly[3]);
    const optionType = monthly[4] as "CE" | "PE";
    if (!Number.isFinite(strike) || strike <= 0 || month < 0) return null;
    return {
      underlying: "NIFTY",
      strike,
      optionType,
      expiry: null,
      expiryPrecision: "month",
      contractYear: year,
      contractMonth: month,
    };
  }

  const weekly = /^(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(rest);
  if (!weekly) return null;
  const year = 2000 + Number(weekly[1]);
  const month = WEEK_MONTH[weekly[2]];
  const day = Number(weekly[3]);
  const strike = Number(weekly[4]);
  const optionType = weekly[5] as "CE" | "PE";
  if (month === undefined || day < 1 || day > 31 || !Number.isFinite(strike) || strike <= 0) return null;
  const expiry = new Date(Date.UTC(year, month, day));
  if (expiry.getUTCMonth() !== month || expiry.getUTCDate() !== day) return null;
  return {
    underlying: "NIFTY",
    strike,
    optionType,
    expiry,
    expiryPrecision: "day",
    contractYear: year,
    contractMonth: month,
  };
}

function finiteOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

export function readInstrumentExpiry(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function indexInstruments(instruments: KiteInstrument[]): Map<string, KiteInstrument> {
  const map = new Map<string, KiteInstrument>();
  for (const instrument of instruments) {
    if (!instrument?.exchange || !instrument.tradingsymbol) continue;
    map.set(quoteKey(instrument.exchange, instrument.tradingsymbol), instrument);
  }
  return map;
}

function istDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The nearest NIFTY future that has not expired, in IST. */
export function findNearNiftyFuture(instruments: KiteInstrument[], now = new Date()): KiteInstrument | null {
  const today = istDay(now);
  const dated = instruments.flatMap((instrument) => {
    if (instrument.exchange !== "NFO" || instrument.name !== "NIFTY" || instrument.instrument_type !== "FUT") return [];
    const expiry = readInstrumentExpiry(instrument.expiry);
    if (!expiry || istDay(expiry) < today) return [];
    return [{ instrument, expiry }];
  });
  dated.sort((left, right) => left.expiry.getTime() - right.expiry.getTime());
  return dated[0]?.instrument ?? null;
}

export function findNiftySpotInstrument(instruments: KiteInstrument[]): KiteInstrument | null {
  return (
    instruments.find((instrument) => instrument.exchange === "NSE" && instrument.tradingsymbol === "NIFTY 50") ?? null
  );
}

function isNiftyOptionInstrument(instrument: KiteInstrument | undefined): boolean {
  if (!instrument) return false;
  return (
    instrument.exchange === "NFO" &&
    instrument.name === "NIFTY" &&
    (instrument.instrument_type === "CE" || instrument.instrument_type === "PE")
  );
}

export function mapNetPosition(
  position: KiteNetPosition,
  instrument: KiteInstrument | undefined,
): MappedOptionPosition | null {
  const parsed = parseNiftyOptionSymbol(position.tradingsymbol);
  const fromMaster = isNiftyOptionInstrument(instrument);
  if (!fromMaster && !parsed) return null;
  if (position.exchange !== "NFO" && instrument?.exchange !== "NFO") return null;

  const warnings: string[] = [];
  const optionType = (
    fromMaster && (instrument?.instrument_type === "CE" || instrument?.instrument_type === "PE")
      ? instrument.instrument_type
      : parsed?.optionType
  ) as "CE" | "PE" | undefined;
  if (!optionType) return null;

  const strike = fromMaster ? finiteOrNull(instrument?.strike) : parsed?.strike ?? null;
  const expiryDate = fromMaster ? readInstrumentExpiry(instrument?.expiry) : parsed?.expiry ?? null;
  if (!fromMaster) {
    warnings.push("This contract was not in the instrument master. Metadata was parsed from the trading symbol.");
  }
  if (expiryDate === null) {
    warnings.push("Expiry date is unavailable, so scenario time decay cannot be calculated for this contract.");
  }
  if (strike === null || strike <= 0) {
    warnings.push("Strike is unavailable.");
  }
  if (parsed && parsed.expiryPrecision === "month" && !fromMaster) {
    warnings.push("Monthly symbols do not encode the expiry day. Expiry was left unavailable instead of guessing.");
  }

  const quantity = position.quantity;
  if (!Number.isFinite(quantity)) {
    warnings.push("Net quantity is not a number.");
  }
  const average = finiteOrNull(position.average_price);
  const averagePrice = average !== null && average > 0 ? average : null;
  if (quantity !== 0 && averagePrice === null) {
    warnings.push("Average price is missing or zero, so entry-based trade P&L is unavailable.");
  }

  const multiplier = finiteOrNull(position.multiplier);
  const expiryEpochMs = expiryDate ? niftySettlementInstant(expiryDate) : null;

  return {
    id: `${position.exchange}:${position.tradingsymbol}:${position.product}`,
    exchange: position.exchange,
    tradingSymbol: position.tradingsymbol,
    instrumentToken: Number(position.instrument_token),
    underlying: "NIFTY",
    strike,
    expiry: expiryDate ? expiryDate.toISOString() : null,
    expiryEpochMs,
    optionType,
    quantity,
    side: quantity < 0 ? "short" : "long",
    multiplier: multiplier && multiplier > 0 ? multiplier : 1,
    lotSize: finiteOrNull(instrument?.lot_size),
    tickSize: finiteOrNull(instrument?.tick_size),
    averagePrice,
    brokerLastPrice: finiteOrNull(position.last_price),
    brokerUnrealised: finiteOrNull(position.unrealised),
    brokerRealised: finiteOrNull(position.realised),
    brokerPnl: finiteOrNull(position.pnl),
    brokerDayPnl: null,
    product: position.product,
    metadataSource: fromMaster ? "instrument-master" : "symbol",
    warnings,
  };
}

export function selectNiftyOptionPositions(
  net: KiteNetPosition[],
  instruments: Map<string, KiteInstrument>,
  options: { includeFlat: boolean },
): { positions: MappedOptionPosition[]; flatCount: number } {
  const positions: MappedOptionPosition[] = [];
  let flatCount = 0;
  for (const position of net) {
    const instrument = instruments.get(quoteKey(position.exchange, position.tradingsymbol));
    const mapped = mapNetPosition(position, instrument);
    if (!mapped) continue;
    if (mapped.quantity === 0) {
      flatCount += 1;
      if (!options.includeFlat) continue;
    }
    positions.push(mapped);
  }
  return { positions, flatCount };
}
