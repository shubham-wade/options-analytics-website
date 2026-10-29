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

/** Report sessions count as published after the cash close, 16:00 IST. */
const REPORT_PUBLISH_MINUTES = 16 * 60;

/**
 * NSE publishes the provisional FII/DII cash print between 17:30 and 18:30 IST.
 * Today’s session is due from the start of that window.
 */
export const FLOW_PUBLISH_MINUTES = 17 * 60 + 30;

/** The session the market report should already have. Today counts only after 16:00 IST. */
export function expectedPublishedDate(now: Date): string {
  return publishedSession(now, REPORT_PUBLISH_MINUTES);
}

/** The cash session whose provisional FII/DII print should already be out. Today counts from 17:30 IST. */
export function expectedFlowDate(now: Date): string {
  return publishedSession(now, FLOW_PUBLISH_MINUTES);
}

function publishedSession(now: Date, afterMinutes: number): string {
  const today = istDateIso(now);
  const parts = istParts(now);
  const ready = parts.hour * 60 + parts.minute >= afterMinutes;
  if (isTradingDay(today) && ready) return today;
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

export const FLOW_LOOKBACKS = [5, 10, 20, 40] as const;

export interface FlowLookback {
  sessions: number;
  /** Saved sessions inside the window. A blank day is not treated as zero. */
  counted: number;
  from: string;
  to: string;
  fii: number;
  dii: number;
}

/** Sums of the last 5, 10, 20 and 40 trading sessions, ending at the newest saved day. */
export function flowLookbacks(points: FlowPoint[], sizes: readonly number[] = FLOW_LOOKBACKS): FlowLookback[] {
  let end = -1;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]?.fii != null || points[index]?.dii != null) {
      end = index;
      break;
    }
  }
  if (end < 0) return [];
  return sizes.map((sessions) => {
    const start = Math.max(0, end - sessions + 1);
    const slice = points.slice(start, end + 1);
    let fii = 0;
    let dii = 0;
    let counted = 0;
    for (const point of slice) {
      if (point.fii == null && point.dii == null) continue;
      counted += 1;
      fii += point.fii ?? 0;
      dii += point.dii ?? 0;
    }
    return {
      sessions,
      counted,
      from: slice[0]?.date ?? points[end].date,
      to: points[end].date,
      fii,
      dii,
    };
  });
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
  const expected = expectedFlowDate(now);
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
      detail: `${flowLabel(expected)} is still missing. NSE publishes the provisional cash print between 5:30 and 6:30 PM IST, and only the latest session.`,
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
