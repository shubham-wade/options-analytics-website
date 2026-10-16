import { NSE_HOLIDAYS, SEASON_END, addCalendarDays, isWeekday } from "@/lib/pnl/daily";
import { istParts, istWallTimeToUtc } from "@/lib/time";

/** Cash-market history starts in July. The axis runs through the same season end as P&L. */
export const FLOW_START = "2026-07-01";
export const FLOW_END = SEASON_END;

/** The chart opens on this many calendar days, ending at the latest saved session. */
export const FLOW_FRAME_DAYS = 90;

export interface FlowEntry {
  fii: number;
  dii: number;
}

export interface FlowBook {
  updatedAt: string | null;
  lastAttemptAt: string | null;
  missed: string[];
  entries: Record<string, FlowEntry>;
}

export interface FlowPoint {
  date: string;
  fii: number | null;
  dii: number | null;
}

export interface FlowNotice {
  key: string;
  title: string;
  detail: string;
}

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

export function istDateIso(now: Date): string {
  const parts = istParts(now);
  return `${parts.year}-${String(parts.month + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isTradingDay(iso: string): boolean {
  return isWeekday(iso) && !NSE_HOLIDAYS[iso];
}

/** The session NSE should already have published. Today counts only after 16:00 IST. */
export function expectedPublishedDate(now: Date): string {
  const today = istDateIso(now);
  const parts = istParts(now);
  const afterClose = parts.hour > 16 || (parts.hour === 16 && parts.minute >= 0);
  if (isTradingDay(today) && afterClose) return today;
  let date = addCalendarDays(today, -1);
  while (!isTradingDay(date)) date = addCalendarDays(date, -1);
  return date;
}

export function buildFlowSeries(entries: Record<string, FlowEntry>): FlowPoint[] {
  const points: FlowPoint[] = [];
  for (let date = FLOW_START; date <= FLOW_END; date = addCalendarDays(date, 1)) {
    if (!isTradingDay(date)) continue;
    const entry = entries[date];
    points.push({
      date,
      fii: entry && Number.isFinite(entry.fii) ? entry.fii : null,
      dii: entry && Number.isFinite(entry.dii) ? entry.dii : null,
    });
  }
  return points;
}

/** Indexes of the sessions that fall in the last 90 calendar days of saved data. */
export function flowFrame(points: FlowPoint[]): { start: number; count: number } {
  let end = -1;
  points.forEach((point, index) => {
    if (point.fii != null || point.dii != null) end = index;
  });
  if (end < 0) return { start: 0, count: Math.max(points.length, 1) };
  const startDate = addCalendarDays(points[end]?.date ?? FLOW_START, -(FLOW_FRAME_DAYS - 1));
  let start = points.findIndex((point) => point.date >= startDate);
  if (start < 0 || start > end) start = end;
  return { start, count: end - start + 1 };
}

export function newestFlowDate(entries: Record<string, FlowEntry>): string | null {
  const dates = Object.keys(entries).filter((date) => entries[date] && Number.isFinite(entries[date].fii)).sort();
  return dates.at(-1) ?? null;
}

/** Trading days after `after` and before `before`. */
export function tradingDaysBetween(after: string, before: string): string[] {
  const dates: string[] = [];
  for (let date = addCalendarDays(after, 1); date < before; date = addCalendarDays(date, 1)) {
    if (isTradingDay(date)) dates.push(date);
  }
  return dates;
}

export function parseNseFiiDii(body: unknown): { date: string; fii: number; dii: number } | null {
  if (!Array.isArray(body)) return null;
  let date = "";
  let fii: number | null = null;
  let dii: number | null = null;
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const record = row as { category?: unknown; date?: unknown; netValue?: unknown };
    const parsedDate = nseDate(record.date);
    const net = typeof record.netValue === "string" || typeof record.netValue === "number" ? Number(record.netValue) : Number.NaN;
    if (!parsedDate || !Number.isFinite(net)) continue;
    date = parsedDate;
    const category = String(record.category ?? "");
    if (category.startsWith("FII")) fii = net;
    if (category === "DII") dii = net;
  }
  if (!date || fii == null || dii == null) return null;
  return { date, fii, dii };
}

export function mergeFlowFetch(
  book: FlowBook,
  fetched: { date: string; fii: number; dii: number } | null,
  now: Date,
): { book: FlowBook; notices: FlowNotice[] } {
  const expected = expectedPublishedDate(now);
  const previous = newestFlowDate(book.entries);
  const next: FlowBook = {
    updatedAt: book.updatedAt,
    lastAttemptAt: now.toISOString(),
    missed: book.missed.filter((date) => !book.entries[date]),
    entries: { ...book.entries },
  };
  if (fetched && isTradingDay(fetched.date)) {
    next.entries[fetched.date] = { fii: fetched.fii, dii: fetched.dii };
    next.updatedAt = now.toISOString();
    next.missed = next.missed.filter((date) => date !== fetched.date);
    if (previous && fetched.date > previous) {
      for (const date of tradingDaysBetween(previous, fetched.date)) {
        if (!next.entries[date] && !next.missed.includes(date)) next.missed.push(date);
      }
    }
  }
  next.missed.sort();
  return { book: next, notices: noticesFor(next, expected, fetched == null) };
}

export function noticesFor(book: FlowBook, expected: string, fetchFailed: boolean): FlowNotice[] {
  const notices: FlowNotice[] = [];
  if (!book.entries[expected] && (fetchFailed || book.lastAttemptAt)) {
    notices.push({
      key: `fii-missing-${expected}`,
      title: "FII/DII not fetched",
      detail: `${flowLabel(expected)} is still missing. NSE publishes only the latest session, after the close.`,
    });
  }
  if (book.missed.length > 0) {
    notices.push({
      key: `fii-gap-${book.missed.join(",")}`,
      title: book.missed.length === 1 ? "One FII/DII day was missed" : `${book.missed.length} FII/DII days were missed`,
      detail: `${book.missed.map(flowLabel).join(", ")} stayed blank. The feed does not go back and fill them.`,
    });
  }
  return notices;
}

export function flowLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function nseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[2] ?? ""];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1]}`;
}

export function atIst(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return istWallTimeToUtc(year, month - 1, day, hour, minute, 0);
}
