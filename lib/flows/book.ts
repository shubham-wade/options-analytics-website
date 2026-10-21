import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFlowSeries,
  expectedFlowDate,
  mergeFlowFetch,
  noticesFor,
  parseNseFiiDii,
  type FlowBook,
  type FlowNotice,
  type FlowPoint,
} from "@/lib/flows/fii-dii";

const FILE = path.join(process.cwd(), "lib", "flows", "fii-dii.json");
const RETRY_MS = 10 * 60 * 1000;
const NSE_URL = "https://www.nseindia.com/api/fiidiiTradeReact";

export interface FlowSnapshot {
  points: FlowPoint[];
  notices: FlowNotice[];
  updatedAt: string | null;
}

export async function refreshFlowBook(now = new Date()): Promise<FlowSnapshot> {
  const book = await readFlowBook();
  const expected = expectedFlowDate(now);
  if (book.entries[expected] && book.missed.length === 0) {
    return snapshot(book, []);
  }
  const attempted = book.lastAttemptAt ? Date.parse(book.lastAttemptAt) : Number.NaN;
  if (book.entries[expected] || (Number.isFinite(attempted) && now.getTime() - attempted < RETRY_MS)) {
    return snapshot(book, noticesFor(book, expected, !book.entries[expected]));
  }
  let fetched: ReturnType<typeof parseNseFiiDii> = null;
  try {
    fetched = parseNseFiiDii(await fetchNseFlows());
  } catch {
    fetched = null;
  }
  const merged = mergeFlowFetch(book, fetched, now);
  await writeFlowBook(merged.book);
  return snapshot(merged.book, merged.notices);
}

async function readFlowBook(): Promise<FlowBook> {
  const raw = await readFile(FILE, "utf8");
  const parsed = JSON.parse(raw) as FlowBook;
  return {
    updatedAt: parsed.updatedAt ?? null,
    lastAttemptAt: parsed.lastAttemptAt ?? null,
    missed: Array.isArray(parsed.missed) ? parsed.missed.filter((date) => typeof date === "string") : [],
    entries: parsed.entries ?? {},
  };
}

async function writeFlowBook(book: FlowBook): Promise<void> {
  const entries = Object.fromEntries(Object.entries(book.entries).sort(([left], [right]) => left.localeCompare(right)));
  const body = { ...book, entries };
  await writeFile(FILE, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

async function fetchNseFlows(): Promise<unknown> {
  const response = await fetch(NSE_URL, {
    headers: {
      Accept: "application/json",
      Referer: "https://www.nseindia.com/reports/fii-dii",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`NSE FII/DII ${response.status}`);
  return response.json() as Promise<unknown>;
}

function snapshot(book: FlowBook, notices: FlowNotice[]): FlowSnapshot {
  return { points: buildFlowSeries(book.entries), notices, updatedAt: book.updatedAt };
}
