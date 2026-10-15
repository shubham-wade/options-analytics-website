/** Asia/Kolkata has no daylight-saving shift. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const DEFAULT_RISK_FREE_RATE = 0.065;
export const DEFAULT_DIVIDEND_YIELD = 0;
export const DEFAULT_SPOT_MOVES = [-500, -200, -100, 0, 100, 200, 500] as const;

export const SETTLEMENT_ASSUMPTION =
  "When a contract expires inside the selected horizon, it is valued at the European cash payoff max(0, spot − strike) for calls and max(0, strike − spot) for puts. The scenario NIFTY level is the settlement price. This is not the official exchange closing auction.";

export const MODEL_DISCLAIMER =
  "Hypothetical premiums and P&L are Black–Scholes–Merton estimates. They are not executable Zerodha prices and exclude brokerage, taxes, slippage and transaction costs. This application is an analytics tool and cannot place, modify or cancel orders.";

export interface IstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function istParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/** Wall-clock Asia/Kolkata time expressed as a UTC instant. */
export function istWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second) - IST_OFFSET_MS);
}

/**
 * Kite access tokens expire at 06:00 Asia/Kolkata on the calendar day
 * after the login time. There is no refresh token for retail API apps.
 */
export function kiteTokenExpiresAt(loginTime: Date): Date {
  const parts = istParts(loginTime);
  return istWallTimeToUtc(parts.year, parts.month, parts.day + 1, 6, 0, 0);
}

export function isKiteTokenExpired(loginTime: Date, now: Date): boolean {
  return now.getTime() >= kiteTokenExpiresAt(loginTime).getTime();
}

/**
 * Kite's raw login_time is an IST wall clock without a zone suffix,
 * for example "2021-01-01 16:15:14". The Node SDK replaces that string
 * with a Date before the response is returned.
 */
export function parseKiteTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return istWallTimeToUtc(year, month - 1, day, hour, minute, second);
}

/** Regular NSE cash/F&O session. Exchange holidays are not modelled. */
export function isNseRegularSession(now: Date): boolean {
  const parts = istParts(now);
  if (parts.weekday === 0 || parts.weekday === 6) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}

/**
 * NIFTY options stop trading at 15:30 IST on the expiry date published
 * by the instrument master.
 */
export function niftySettlementInstant(expiry: Date): number {
  const isoDate = expiry.toISOString().slice(0, 10);
  const [year, month, day] = isoDate.split("-").map(Number);
  return istWallTimeToUtc(year, month - 1, day, 15, 30, 0).getTime();
}

export function timeToExpiryYears(expiryMs: number, nowMs: number, horizonDays: number): number {
  const remainingMs = expiryMs - nowMs - horizonDays * 24 * 60 * 60 * 1000;
  return remainingMs / YEAR_MS;
}
