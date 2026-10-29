import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { istParts } from "@/lib/time";
import {
  averageFromMinuteBars,
  companyIdentity,
  parseFundamentals,
  parseHolding,
  parseHoldings,
  parseLivePrice,
  parseStatements,
  publishedStatements,
} from "@/lib/stocks/parse";
import type { StockFile, StockPrice, StockSnapshot, StockSummary } from "@/lib/stocks/types";

const GROWW = "https://groww.in";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class StockError extends Error {
  constructor(
    readonly code: "invalid_symbol" | "not_found" | "source",
    message: string,
  ) {
    super(message);
  }
}

export function stockSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    throw new StockError("invalid_symbol", "Use the NSE symbol, for example SUZLON.");
  }
  return symbol;
}

export function istDateStamp(date: Date): string {
  const parts = istParts(date);
  const month = String(parts.month + 1).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function stockPath(symbol: string): string {
  return path.join(process.cwd(), "data", "stocks", `${symbol}.json`);
}

async function growwJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new StockError("source", `The company feed returned ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

async function findSearchId(symbol: string): Promise<{ searchId: string; title: string }> {
  const url = `${GROWW}/v1/api/search/v3/query/global/st_p_query?page=0&query=${encodeURIComponent(symbol)}&size=8`;
  const body = await growwJson(url);
  const content = (body as { data?: { content?: unknown[] } }).data?.content;
  if (!Array.isArray(content)) throw new StockError("not_found", `${symbol} was not found on the NSE feed.`);
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const row = item as { entity_type?: string; nse_scrip_code?: string; search_id?: string; title?: string };
    if (row.entity_type === "Stocks" && row.nse_scrip_code === symbol && row.search_id) {
      return { searchId: row.search_id, title: row.title || symbol };
    }
  }
  throw new StockError("not_found", `${symbol} was not found as an NSE equity.`);
}

export async function readStock(symbol: string): Promise<StockFile | null> {
  try {
    const raw = await readFile(stockPath(stockSymbol(symbol)), "utf8");
    return JSON.parse(raw) as StockFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listStocks(): Promise<StockSummary[]> {
  const dir = path.join(process.cwd(), "data", "stocks");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => readStock(name.replace(/\.json$/, ""))),
  );
  return files
    .filter((file): file is StockFile => file != null)
    .map((file) => {
      const latest = file.snapshots[file.snapshots.length - 1];
      return {
        symbol: file.symbol,
        name: file.name,
        industry: file.industry,
        savedOn: latest?.date ?? null,
        price: latest?.price.last ?? null,
        changePercent: latest?.price.changePercent ?? null,
        readings: file.snapshots.length,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function dayAverage(symbol: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1m&range=1d`,
      { headers: { Accept: "application/json", "User-Agent": UA }, cache: "no-store" },
    );
    if (!response.ok) return null;
    return averageFromMinuteBars(await response.json());
  } catch {
    return null;
  }
}

/** Latest NSE cash print. Does not write a stock file. */
export async function quoteEquity(symbolInput: string): Promise<StockPrice> {
  const symbol = stockSymbol(symbolInput);
  const live = await growwJson(
    `${GROWW}/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(symbol)}/latest`,
  );
  return parseLivePrice(live, null, null);
}

export async function refreshStock(
  symbolInput: string,
  now = new Date(),
  priceOverride?: StockPrice | null,
): Promise<StockFile> {
  const symbol = stockSymbol(symbolInput);
  const found = await findSearchId(symbol);
  const company = await growwJson(`${GROWW}/v1/api/stocks_data/v1/company/search_id/${encodeURIComponent(found.searchId)}`);
  const identity = companyIdentity(company);
  const record = company as { fundamentals?: unknown; shareHoldingPattern?: unknown };
  const fundamentals = parseFundamentals(record.fundamentals);
  const holding = parseHolding(record.shareHoldingPattern);
  const holdings = parseHoldings(record.shareHoldingPattern);
  const published = publishedStatements(company);
  const statements = parseStatements(published.statements);
  const live = await growwJson(
    `${GROWW}/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(symbol)}/latest`,
  );
  const growwPrice = parseLivePrice(live, identity.yearHigh, identity.yearLow);
  const barAverage = await dayAverage(symbol);
  if (barAverage != null) {
    growwPrice.average = barAverage;
    growwPrice.averageSource = "bars";
  }
  const price = priceOverride?.last != null
    ? {
        ...growwPrice,
        last: priceOverride.last,
        change: priceOverride.change,
        changePercent: priceOverride.changePercent,
        open: priceOverride.open ?? growwPrice.open,
        high: priceOverride.high ?? growwPrice.high,
        low: priceOverride.low ?? growwPrice.low,
        previousClose: priceOverride.previousClose ?? growwPrice.previousClose,
        volume: priceOverride.volume ?? growwPrice.volume,
        average: priceOverride.average ?? growwPrice.average,
        averageSource: priceOverride.average != null ? priceOverride.averageSource : growwPrice.averageSource,
        source: priceOverride.source,
      }
    : growwPrice;
  const snapshot: StockSnapshot = {
    date: istDateStamp(now),
    savedAt: now.toISOString(),
    price,
    fundamentals,
    holding,
    holdings,
    years: statements.years,
    quarters: statements.quarters,
    accounts: published.accounts,
  };
  const existing = await readStock(symbol);
  const snapshots = existing ? [...existing.snapshots] : [];
  const sameDay = snapshots.findIndex((item) => item.date === snapshot.date);
  if (sameDay >= 0) snapshots[sameDay] = snapshot;
  else snapshots.push(snapshot);
  const file: StockFile = {
    symbol,
    name: identity.name || found.title,
    isin: identity.isin,
    industry: identity.industry,
    exchange: "NSE",
    searchId: found.searchId,
    snapshots,
  };
  const dir = path.join(process.cwd(), "data", "stocks");
  await mkdir(dir, { recursive: true });
  await writeFile(stockPath(symbol), `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}
