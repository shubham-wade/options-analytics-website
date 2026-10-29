/** Weekday season from 1 Oct 2026 through 31 Mar 2027. Weekends are never plotted. */
export const SEASON_START = "2026-10-01";
export const SEASON_END = "2027-03-31";

/**
 * Weekday closures from the NSE 2026 holiday circular, plus Republic Day 2027.
 * NSE has not published the 2027 festival list, so those dates are not guessed.
 */
export const NSE_HOLIDAYS: Record<string, string> = {
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali-Balipratipada",
  "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
  "2026-12-25": "Christmas",
  "2027-01-26": "Republic Day",
};

/** Cumulative P&L from 1 April, in ₹ lakhs. Every supplied figure is a loss. */
export const SEEDED_DAILY_PNL: Record<string, number> = {
  "2026-10-01": -20.95,
  "2026-10-05": -20.3,
  "2026-10-06": -19.35,
  "2026-10-07": -19.7,
  "2026-10-08": -20.95,
  "2026-10-09": -20.2,
  "2026-10-12": -20.6,
  "2026-10-13": -19.45,
  "2026-10-14": -19.95,
  "2026-10-15": -19.85,
  "2026-10-16": -19.5,
  "2026-10-19": -20,
  "2026-10-21": -20.65,
  "2026-10-22": -20.85,
  "2026-10-23": -21.65,
  "2026-10-26": -20.70,
  "2026-10-27": -20.75,
  "2026-10-28": -20.50,
  "2026-10-29": -19.65,
};

export interface DailyPnlPoint {
  date: string;
  pnl: number | null;
}

export function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekday(iso: string): boolean {
  const day = weekdayIndex(iso);
  return day !== 0 && day !== 6;
}

export function buildDailySeries(entries: Record<string, number>): DailyPnlPoint[] {
  const points: DailyPnlPoint[] = [];
  for (let date = SEASON_START; date <= SEASON_END; date = addCalendarDays(date, 1)) {
    if (!isWeekday(date) || NSE_HOLIDAYS[date]) continue;
    const pnl = entries[date];
    points.push({ date, pnl: typeof pnl === "number" && Number.isFinite(pnl) ? pnl : null });
  }
  return points;
}

export interface SignedPnlPoint {
  x: number;
  date: string;
  pnl: number | null;
  loss: number | null;
  gain: number | null;
  crossing: boolean;
}

function signedValue(pnl: number | null): { loss: number | null; gain: number | null } {
  if (pnl == null) return { loss: null, gain: null };
  if (pnl < 0) return { loss: pnl, gain: null };
  if (pnl > 0) return { loss: null, gain: pnl };
  return { loss: 0, gain: 0 };
}

/** Splits the running total so the line can be red below zero and green above it. */
export function signedProgressSeries(points: DailyPnlPoint[]): SignedPnlPoint[] {
  const rows: SignedPnlPoint[] = points.map((point, index) => ({
    x: index,
    date: point.date,
    pnl: point.pnl,
    crossing: false,
    ...signedValue(point.pnl),
  }));
  const crossings: SignedPnlPoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]?.pnl;
    const right = points[index + 1]?.pnl;
    if (left == null || right == null || left === 0 || right === 0) continue;
    if ((left < 0 && right > 0) || (left > 0 && right < 0)) {
      const share = Math.abs(left) / (Math.abs(left) + Math.abs(right));
      crossings.push({
        x: index + share,
        date: points[index]?.date ?? "",
        pnl: 0,
        loss: 0,
        gain: 0,
        crossing: true,
      });
    }
  }
  return [...rows, ...crossings].sort((left, right) => left.x - right.x);
}

/** Latest cumulative total, and how far it has moved since the first entered day. */
export function progressSummary(points: DailyPnlPoint[]): { latest: number | null; asOf: string | null; change: number | null; count: number } {
  const known = points.filter((point) => point.pnl != null);
  const first = known[0];
  const last = known[known.length - 1];
  if (!first || !last || first.pnl == null || last.pnl == null) {
    return { latest: null, asOf: null, change: null, count: 0 };
  }
  return { latest: last.pnl, asOf: last.date, change: last.pnl - first.pnl, count: known.length };
}
