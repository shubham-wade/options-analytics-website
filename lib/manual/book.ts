import { parseNiftyOptionSymbol } from "@/lib/kite/positions";
import type { ScenarioPosition } from "@/lib/scenario/engine";
import { niftySettlementInstant, timeToExpiryYears } from "@/lib/time";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface ManualEntry {
  id: string;
  symbol: string;
  quantity: string;
  average: string;
  price: string;
  /** yyyy-mm-dd. Required when the symbol only names the expiry month. */
  expiry: string;
  included: boolean;
}

export interface PreparedManualLeg {
  id: string;
  tradingSymbol: string;
  optionType: "CE" | "PE" | null;
  strike: number | null;
  side: "long" | "short" | null;
  quantity: number | null;
  average: number | null;
  price: number | null;
  expiry: string | null;
  expiryFromSymbol: boolean;
  error: string | null;
  /** Shown with the row, without blocking IV and Greeks. */
  note: string | null;
  position: ScenarioPosition | null;
}

export function prepareManualLeg(entry: ManualEntry, now: Date): PreparedManualLeg {
  const tradingSymbol = entry.symbol.trim().toUpperCase();
  const base: PreparedManualLeg = {
    id: entry.id,
    tradingSymbol,
    optionType: null,
    strike: null,
    side: null,
    quantity: null,
    average: null,
    price: null,
    expiry: null,
    expiryFromSymbol: false,
    error: null,
    note: null,
    position: null,
  };
  const touched = Boolean(tradingSymbol || entry.quantity.trim() || entry.average.trim() || entry.price.trim() || entry.expiry.trim());
  if (!touched) return base;

  const parsed = tradingSymbol ? parseNiftyOptionSymbol(tradingSymbol) : null;
  if (!parsed) {
    return { ...base, error: "Use a NIFTY option symbol such as NIFTY26DEC22000PE." };
  }

  const expiryFromSymbol = parsed.expiryPrecision === "day" && parsed.expiry !== null;
  const expiryIso = expiryFromSymbol ? parsed.expiry!.toISOString().slice(0, 10) : entry.expiry.trim();
  const expiry = parseContractDate(expiryIso, parsed.contractYear, parsed.contractMonth);
  const quantity = readNumber(entry.quantity);
  const average = readNumber(entry.average);
  const price = readNumber(entry.price);
  const error = legError(expiryIso, expiry, quantity, price, parsed.contractYear, parsed.contractMonth);
  const averageMissing = average === null || !Number.isFinite(average) || average <= 0;

  const prepared: PreparedManualLeg = {
    ...base,
    optionType: parsed.optionType,
    strike: parsed.strike,
    side: quantity !== null && Number.isFinite(quantity) ? (quantity < 0 ? "short" : "long") : null,
    quantity: quantity !== null && Number.isFinite(quantity) ? quantity : null,
    average: average !== null && Number.isFinite(average) ? average : null,
    price: price !== null && Number.isFinite(price) ? price : null,
    expiry: expiry ? expiryIso : null,
    expiryFromSymbol,
    error,
    note: averageMissing && !error ? "Average price is missing, so trade P&L is unavailable. IV and Greeks use the live quote." : null,
  };
  if (error || !expiry || quantity === null || price === null) return prepared;

  prepared.position = {
    id: entry.id,
    tradingSymbol,
    right: parsed.optionType,
    strike: parsed.strike,
    quantity,
    multiplier: 1,
    entryPremium: averageMissing ? null : average,
    marketPremium: price,
    timeYears: timeToExpiryYears(niftySettlementInstant(expiry), now.getTime(), 0),
  };
  return prepared;
}

export function includedScenarioPositions(entries: ManualEntry[], legs: PreparedManualLeg[]): ScenarioPosition[] {
  const included = new Set(entries.filter((entry) => entry.included).map((entry) => entry.id));
  return legs.flatMap((leg) => (included.has(leg.id) && leg.position ? [leg.position] : []));
}

/** The first empty form. Saving this over a real book would erase contracts the user did not delete. */
export function isBlankManualDraft(rows: ManualEntry[], spot: string): boolean {
  if (spot.trim() !== "" || rows.length !== 1) return false;
  const row = rows[0];
  return (
    row?.id === "draft" &&
    !row.symbol.trim() &&
    !row.quantity.trim() &&
    !row.average.trim() &&
    !row.price.trim() &&
    !row.expiry.trim()
  );
}

function legError(
  expiryIso: string,
  expiry: Date | null,
  quantity: number | null,
  price: number | null,
  year: number,
  month: number,
): string | null {
  if (!expiryIso) return `Enter the expiry date. This symbol only names ${MONTHS[month]} ${year}.`;
  if (!expiry) return `Expiry must be a real day in ${MONTHS[month]} ${year}.`;
  if (quantity === null) return "Enter the signed quantity. A negative quantity is a short.";
  if (!Number.isFinite(quantity) || quantity === 0) return "Quantity must be a non-zero number of option units.";
  if (price === null || !Number.isFinite(price) || price <= 0) return "The live Kite quote is not available yet.";
  return null;
}

function readNumber(value: string): number | null {
  const text = value.trim().replace("−", "-");
  if (!text) return null;
  return Number(text);
}

function parseContractDate(iso: string, year: number, month: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const parsedYear = Number(match[1]);
  const parsedMonth = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (parsedYear !== year || parsedMonth !== month) return null;
  const date = new Date(Date.UTC(parsedYear, parsedMonth, day));
  if (date.getUTCFullYear() !== parsedYear || date.getUTCMonth() !== parsedMonth || date.getUTCDate() !== day) return null;
  return date;
}
