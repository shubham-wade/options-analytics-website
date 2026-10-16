import "server-only";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { refreshFlowBook } from "@/lib/flows/book";
import { isTradingDay } from "@/lib/flows/fii-dii";
import { addCalendarDays } from "@/lib/pnl/daily";
import {
  buildFuturesRead,
  evidenceFrom,
  indexPrint,
  parseIndexClose,
  parseParticipantOi,
  participantRows,
  indexContributors,
  summarizeCash,
  summarizeChain,
  vixPrint,
} from "@/lib/report/parse";
import { REPORT_RETRY_MS, latestReportDate, liveCaptureAllowed, pendingReportDates, reportReady, resolveReportDate } from "@/lib/report/sessions";
import type { MarketReport, SectorMove } from "@/lib/report/types";

const HEADERS = {
  Accept: "application/json,text/csv,text/plain,*/*",
  Referer: "https://www.nseindia.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const SECTORS = [
  "NIFTY AUTO",
  "NIFTY IT",
  "NIFTY FMCG",
  "NIFTY METAL",
  "NIFTY PHARMA",
  "NIFTY REALTY",
  "NIFTY ENERGY",
  "NIFTY INFRA",
  "NIFTY PSU BANK",
  "NIFTY FINANCIAL SERVICES",
  "NIFTY MEDIA",
  "NIFTY HEALTHCARE",
];

let ensuring: Promise<void> | null = null;

/** Saves the latest close, and any sessions missed while this machine was off. */
export function ensureDueReports(now = new Date()): Promise<void> {
  if (!ensuring) ensuring = runEnsure(now).finally(() => { ensuring = null; });
  return ensuring;
}

async function runEnsure(now: Date): Promise<void> {
  const latest = latestReportDate(now);
  const missing = pendingReportDates(await savedReportDates(), latest).filter((date) => date !== latest);
  for (const date of missing) {
    try {
      await loadMarketReport(now, false, date);
    } catch {
      // The next visit tries this session again.
    }
  }
  await loadMarketReport(now, false, latest);
}

export async function loadMarketReport(now = new Date(), refresh = false, requested: string | null = null): Promise<MarketReport> {
  const asOf = resolveReportDate(requested, latestReportDate(now));
  const cachePath = path.join(process.cwd(), "data", "reports", `${asOf}.json`);
  const live = liveCaptureAllowed(now, asOf);
  const cached = await readCache(cachePath);
  if (!refresh && cached?.asOf === asOf && keepCached(cached, live, now)) return cached;
  if (asOf === latestReportDate(now)) {
    try {
      await refreshFlowBook(now);
    } catch {
      // Cash stays on whatever was already saved.
    }
  }
  const report = await fetchMarketReport(asOf, live);
  if (cached?.contributors && !report.contributors) {
    report.contributors = cached.contributors;
    if (cached.chains.length > 0) report.chains = cached.chains;
    report.gaps = report.gaps.filter((gap) => !gap.startsWith("NIFTY stock weights"));
  }
  const mode = report.contributors && report.chains.length > 0 ? "live" : live ? "live" : "archive";
  report.settled = reportReady(report, mode);
  report.lastAttemptAt = now.toISOString();
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function fetchMarketReport(asOf: string, live: boolean): Promise<MarketReport> {
  const gaps: string[] = [];
  const previous = previousTradingDay(asOf);
  const [indices, constituents, todayOi, previousOi, expiries, volatility, cashEntries] = await Promise.all([
    live
      ? readJson("https://www.nseindia.com/api/allIndices").catch(() => null)
      : readText(indexCloseUrl(asOf)).catch(() => null),
    live
      ? readJson("https://www.nseindia.com/api/equity-stock-indices?index=NIFTY%2050").catch(() => null)
      : Promise.resolve(null),
    readText(participantUrl(asOf)).catch(() => null),
    readText(participantUrl(previous)).catch(() => null),
    live
      ? readJson("https://www.nseindia.com/api/option-chain-contract-info?symbol=NIFTY").catch(() => null)
      : Promise.resolve(null),
    readText(volatilityUrl(asOf)).catch(() => null),
    readCashEntries(),
  ]);

  const rows = typeof indices === "string" ? parseIndexClose(indices) : indexRows(indices);
  const nifty = indexPrint("NIFTY 50", rows.get("NIFTY 50"));
  const bankNifty = indexPrint("NIFTY BANK", rows.get("NIFTY BANK"));
  const vix = vixPrint(rows.get("INDIA VIX"));
  if (!nifty) gaps.push("NIFTY 50 open, high, low and close were not in the NSE index feed.");
  if (!bankNifty) gaps.push("BANK NIFTY prices were not in the NSE index feed.");
  if (!vix) gaps.push("India VIX was not in the NSE index feed.");

  const sectors: SectorMove[] = SECTORS.flatMap((name) => {
    const change = numberField(rows.get(name)?.percentChange);
    return change == null ? [] : [{ name, percentChange: change }];
  }).sort((left, right) => right.percentChange - left.percentChange);
  if (sectors.length === 0) gaps.push("Sector index changes were not in the NSE index feed.");
  const contributors = indexContributors(constituents);
  if (!contributors && live) gaps.push("NIFTY 50 stock weights and point contributions were not available.");
  if (!live) gaps.push("NIFTY stock weights and the option chain are kept for the latest session. An older date uses the saved close, cash, and derivatives files.");

  const todayBook = todayOi ? parseParticipantOi(todayOi) : null;
  const previousBook = previousOi ? parseParticipantOi(previousOi) : null;
  if (!todayBook || Object.keys(todayBook.rows).length === 0) gaps.push("Participant-wise derivatives open interest was not available.");
  const participants = todayBook ? participantRows(todayBook.rows, previousBook?.rows ?? null) : [];
  const futures = buildFuturesRead(
    nifty?.change ?? null,
    todayBook?.indexFutureOi ?? null,
    previousBook?.indexFutureOi ?? null,
  );

  const expiryList = live ? expiryDates(expiries).slice(0, 2) : [];
  if (live && expiryList.length === 0) gaps.push("NIFTY option expiries were not listed.");
  const chains = [];
  for (const expiry of expiryList) {
    const payload = await readJson(`https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY&expiry=${encodeURIComponent(expiry)}`).catch(() => null);
    const summary = summarizeChain(expiry, payload, nifty?.close ?? null);
    if (summary) chains.push(summary);
    else gaps.push(`NIFTY option chain for ${expiry} did not load.`);
  }

  const cash = summarizeCash(asOf, cashEntries);
  if (!cash.today) gaps.push("Today’s FII and DII cash flow is not in the saved file.");

  const fii = participants.find((row) => row.name === "FII");
  const evidence = evidenceFrom({
    nifty,
    cashFii: cash.today?.fii ?? null,
    cashDii: cash.today?.dii ?? null,
    fiiLongRatio: fii?.longRatio ?? null,
    fiiRatioChange: fii?.longRatioChange ?? null,
    pcr: chains[0]?.pcr ?? null,
    vixChange: vix?.change ?? null,
    futuresReading: futures?.reading ?? null,
  });

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    nifty,
    bankNifty,
    vix,
    sectors,
    contributors,
    cash,
    participants,
    participantAsOf: todayBook?.asOf ?? null,
    participantPrevious: previousBook?.asOf ?? null,
    futures,
    chains,
    volatility: parseVolatility(volatility),
    portfolio: null,
    evidence,
    gaps,
    settled: false,
    lastAttemptAt: new Date().toISOString(),
    sources: [
      { name: "NSE index feed", detail: "NIFTY 50, BANK NIFTY, India VIX, advances and declines, sector moves. Unofficial site feed." },
      { name: "NSE NIFTY 50 constituents", detail: "Free-float weight at the previous close times today’s price change, scaled by the index divisor implied by those weights. The 50 estimates add up to the index move." },
      { name: "NSE participant-wise open interest", detail: "FII, DII, proprietary and client contracts. End-of-day file." },
      { name: "NSE option chain", detail: "Nearest two NIFTY expiries. Put-call ratio is put open interest divided by call open interest." },
      { name: "NSE futures volatility file", detail: "Daily underlying volatility for NIFTY. Not a 5-, 10- or 20-session realised figure." },
      { name: "Saved FII/DII cash file", detail: "Provisional combined cash-market nets. Five-day and month figures sum the saved sessions only." },
    ],
  };
}

function keepCached(cached: MarketReport, live: boolean, now: Date): boolean {
  if (cached.contributors && !live) return true;
  if (cached.settled === true) return true;
  if (cached.settled !== false && reportReady(cached, live ? "live" : "archive")) return true;
  const attempted = Date.parse(cached.lastAttemptAt ?? "");
  return Number.isFinite(attempted) && now.getTime() - attempted < REPORT_RETRY_MS;
}

async function savedReportDates(): Promise<string[]> {
  try {
    const names = await readdir(path.join(process.cwd(), "data", "reports"));
    return names.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map((name) => name.slice(0, 10));
  } catch {
    return [];
  }
}

function previousTradingDay(iso: string): string {
  let date = addCalendarDays(iso, -1);
  while (!isTradingDay(date)) date = addCalendarDays(date, -1);
  return date;
}

function indexCloseUrl(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `https://archives.nseindia.com/content/indices/ind_close_all_${day}${month}${year}.csv`;
}

function participantUrl(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `https://archives.nseindia.com/content/nsccl/fao_participant_oi_${day}${month}${year}.csv`;
}

function volatilityUrl(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `https://archives.nseindia.com/archives/nsccl/volt/FOVOLT_${day}${month}${year}.csv`;
}

function indexRows(body: unknown): Map<string, Record<string, unknown>> {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(data)) return map;
  for (const row of data) {
    if (row && typeof row === "object" && typeof (row as { index?: unknown }).index === "string") {
      map.set((row as { index: string }).index, row as Record<string, unknown>);
    }
  }
  return map;
}

function expiryDates(body: unknown): string[] {
  const dates = body && typeof body === "object" ? (body as { expiryDates?: unknown }).expiryDates : null;
  return Array.isArray(dates) ? dates.filter((date): date is string => typeof date === "string") : [];
}

function parseVolatility(csv: string | null): MarketReportVolatility {
  if (!csv) return null;
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = (lines[0] ?? "").split(",").map((cell) => cell.trim());
  const row = lines.find((line) => line.includes(",NIFTY,"));
  if (!row) return null;
  const cells = row.split(",").map((cell) => cell.trim());
  const dailyIndex = header.findIndex((name) => name.includes("Current Day Underlying Daily Volatility"));
  const daily = dailyIndex >= 0 ? Number(cells[dailyIndex]) : null;
  return {
    daily: daily != null && Number.isFinite(daily) ? daily : null,
    note: "From the NSE futures volatility file for NIFTY. This is one day’s figure, not realised volatility over 5, 10 or 20 sessions.",
  };
}

type MarketReportVolatility = { daily: number | null; note: string } | null;

async function readCashEntries(): Promise<Record<string, { fii: number; dii: number }>> {
  try {
    const raw = await readFile(path.join(process.cwd(), "lib", "flows", "fii-dii.json"), "utf8");
    const parsed = JSON.parse(raw) as { entries?: Record<string, { fii: number; dii: number }> };
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<unknown>;
}

async function readText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readCache(file: string): Promise<import("@/lib/report/types").MarketReport | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as import("@/lib/report/types").MarketReport;
  } catch {
    return null;
  }
}
