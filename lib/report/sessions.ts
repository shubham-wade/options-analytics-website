import { FLOW_START, expectedPublishedDate, isTradingDay, istDateIso } from "@/lib/flows/fii-dii";
import { addCalendarDays } from "@/lib/pnl/daily";
import { istParts } from "@/lib/time";

/** Wait this long before trying a session again when a file was not up yet. */
export const REPORT_RETRY_MS = 15 * 60 * 1000;

export function latestReportDate(now = new Date()): string {
  return expectedPublishedDate(now);
}

/** Trading sessions from the first saved cash date through the latest published session, newest first. */
export function reportSessions(latest: string): string[] {
  const dates: string[] = [];
  for (let date = latest; date >= FLOW_START; date = addCalendarDays(date, -1)) {
    if (isTradingDay(date)) dates.push(date);
  }
  return dates;
}

/**
 * The live NSE board still shows the last close before 09:15 IST, after 16:00 IST,
 * and all day on weekends and holidays. Between the open and 16:00 it is today's tape.
 */
export function liveCaptureAllowed(now: Date, asOf: string): boolean {
  if (asOf !== latestReportDate(now)) return false;
  const today = istDateIso(now);
  if (!isTradingDay(today)) return true;
  const parts = istParts(now);
  const minutes = parts.hour * 60 + parts.minute;
  return minutes < 9 * 60 + 15 || minutes >= 16 * 60;
}

export function pendingReportDates(saved: string[], latest: string, limit = 5): string[] {
  const have = new Set(saved.filter((date) => isTradingDay(date) && date >= FLOW_START && date <= latest));
  let newest = "";
  for (const date of have) if (date > newest) newest = date;
  const pending: string[] = [];
  for (let date = newest ? addCalendarDays(newest, 1) : latest; date <= latest && pending.length < limit; date = addCalendarDays(date, 1)) {
    if (isTradingDay(date) && !have.has(date)) pending.push(date);
  }
  return pending;
}

export function reportReady(
  report: {
    nifty: unknown;
    participants: unknown[];
    contributors: unknown;
    chains: unknown[];
    cash: { today: unknown };
    volatility: { daily: number | null } | null;
  },
  mode: "live" | "archive",
): boolean {
  if (!report.nifty || report.participants.length === 0) return false;
  if (mode === "archive") return true;
  return Boolean(report.contributors && report.chains.length > 0 && report.cash.today && report.volatility?.daily != null);
}

export function resolveReportDate(requested: string | null, latest: string): string {
  if (
    requested
    && /^\d{4}-\d{2}-\d{2}$/.test(requested)
    && requested >= FLOW_START
    && requested <= latest
    && isTradingDay(requested)
  ) {
    return requested;
  }
  return latest;
}
