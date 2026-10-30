import { asRecord, publishedNumber, round2 } from "@/lib/stocks/parse";
import type { StockPeHistory } from "@/lib/stocks/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TAPE_HEADERS = {
  Accept: "application/json",
  "User-Agent": UA,
  Referer: "https://www.tickertape.in/",
};

/** Skip a print when TTM earnings are near zero. */
const PE_MAX = 1000;

export interface DatedEps {
  date: string;
  eps: number;
}

export interface DatedClose {
  date: string;
  close: number;
}

function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function istDay(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function tickerTapeSid(body: unknown, symbol: string): string | null {
  const rows = asRecord(asRecord(body)?.data)?.searchResults;
  if (!Array.isArray(rows)) return null;
  const wanted = symbol.trim().toUpperCase();
  for (const item of rows) {
    const row = asRecord(item);
    const ticker = asRecord(asRecord(row?.stock)?.info)?.ticker;
    const sid = typeof row?.sid === "string" ? row.sid.trim() : "";
    if (typeof ticker === "string" && ticker.trim().toUpperCase() === wanted && sid) return sid;
  }
  return null;
}

export function quarterlyEps(body: unknown): DatedEps[] {
  const rows = asRecord(body)?.data;
  if (!Array.isArray(rows)) return [];
  const out: DatedEps[] = [];
  for (const item of rows) {
    const row = asRecord(item);
    const date = isoDay(row?.endDate);
    const eps = publishedNumber(row?.qIncEps);
    if (!date || eps == null) continue;
    out.push({ date, eps });
  }
  return out.sort((left, right) => left.date.localeCompare(right.date));
}

/** Four-quarter trailing EPS, dated at the newest quarter in the window. */
export function trailingEps(quarters: DatedEps[]): DatedEps[] {
  const out: DatedEps[] = [];
  for (let index = 3; index < quarters.length; index += 1) {
    const window = quarters.slice(index - 3, index + 1);
    const eps = round2(window.reduce((sum, row) => sum + row.eps, 0));
    if (eps == null) continue;
    out.push({ date: quarters[index].date, eps });
  }
  return out;
}

export function weeklyCloses(body: unknown): DatedClose[] {
  const chart = asRecord(asRecord(body)?.chart);
  const first = Array.isArray(chart?.result) ? asRecord(chart.result[0]) : null;
  const times = first?.timestamp;
  const quotes = asRecord(first?.indicators)?.quote;
  const close = Array.isArray(quotes) ? asRecord(quotes[0])?.close : null;
  if (!Array.isArray(times) || !Array.isArray(close)) return [];
  const out: DatedClose[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const stamp = times[index];
    const price = publishedNumber(close[index]);
    if (typeof stamp !== "number" || price == null || price <= 0) continue;
    out.push({ date: istDay(stamp), close: price });
  }
  return out;
}

export function peValues(closes: DatedClose[], trailing: DatedEps[]): number[] {
  if (closes.length === 0 || trailing.length === 0) return [];
  const out: number[] = [];
  let cursor = 0;
  for (const bar of closes) {
    while (cursor + 1 < trailing.length && trailing[cursor + 1].date <= bar.date) cursor += 1;
    const eps = trailing[cursor];
    if (!eps || eps.date > bar.date || eps.eps <= 0) continue;
    const pe = bar.close / eps.eps;
    if (!Number.isFinite(pe) || pe <= 0 || pe > PE_MAX) continue;
    out.push(pe);
  }
  return out;
}

export function summarisePe(values: number[], asOf: string | null = null): StockPeHistory {
  if (values.length === 0) return { median: null, high: null, samples: 0, asOf };
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? round2(sorted[mid]) : round2((sorted[mid - 1] + sorted[mid]) / 2);
  return {
    median,
    high: round2(sorted[sorted.length - 1]),
    samples: sorted.length,
    asOf,
  };
}

async function tapeJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { headers: TAPE_HEADERS, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Listed-history trailing P/E: TickerTape quarterly EPS and Yahoo weekly closes. */
export async function loadPeHistory(symbol: string): Promise<StockPeHistory | null> {
  const found = await tapeJson(`https://api.tickertape.in/stocks/search?text=${encodeURIComponent(symbol)}`);
  const sid = tickerTapeSid(found, symbol);
  if (!sid) return null;
  const income = await tapeJson(
    `https://api.tickertape.in/stocks/financials/income/${encodeURIComponent(sid)}/interim/normal?count=40`,
  );
  const trailing = trailingEps(quarterlyEps(income));
  if (trailing.length === 0) return null;
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1wk&range=max`,
      { headers: { Accept: "application/json", "User-Agent": UA }, cache: "no-store" },
    );
    if (!response.ok) return null;
    const closes = weeklyCloses(await response.json());
    const values = peValues(closes, trailing);
    if (values.length === 0) return null;
    return summarisePe(values, closes.at(-1)?.date ?? trailing.at(-1)?.date ?? null);
  } catch {
    return null;
  }
}
