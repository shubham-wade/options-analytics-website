import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  averageExit,
  bookTotals,
  buyLot,
  emptyBook,
  PaperError,
  rangeLines,
  rangePercents,
  realisedPnl,
  remainingQuantity,
  sellLot,
  type PaperBook,
  type RangeContext,
} from "@/lib/paper/lots";
import type { PaperDesk } from "@/lib/paper/view";
import { istDateStamp, listStocks, quoteEquity, readStock, StockError } from "@/lib/stocks/book";
import { round2 } from "@/lib/stocks/parse";
import type { StockFile, StockPrice } from "@/lib/stocks/types";


function bookPath(): string {
  return path.join(process.cwd(), "data", "paper", "book.json");
}

export async function readPaperBook(): Promise<PaperBook> {
  try {
    const raw = await readFile(bookPath(), "utf8");
    const parsed = JSON.parse(raw) as PaperBook;
    return Array.isArray(parsed.lots) ? { lots: parsed.lots } : emptyBook();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyBook();
    throw error;
  }
}

async function writePaperBook(book: PaperBook): Promise<void> {
  const dir = path.join(process.cwd(), "data", "paper");
  await mkdir(dir, { recursive: true });
  await writeFile(bookPath(), `${JSON.stringify(book, null, 2)}\n`, "utf8");
}

async function liveQuotes(symbols: string[]): Promise<Map<string, StockPrice | null>> {
  const unique = [...new Set(symbols)];
  const entries = await Promise.all(
    unique.map(async (symbol) => {
      try {
        return [symbol, await quoteEquity(symbol)] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  return new Map(entries);
}

function fileMark(file: StockFile | null): { last: number | null; yearLow: number | null; yearHigh: number | null; firstPrice: number | null; firstDate: string | null } {
  const snapshots = file?.snapshots ?? [];
  const first = snapshots.find((snapshot) => snapshot.price.last != null) ?? null;
  const latest = snapshots[snapshots.length - 1] ?? null;
  return {
    last: latest?.price.last ?? null,
    yearLow: latest?.price.yearLow ?? null,
    yearHigh: latest?.price.yearHigh ?? null,
    firstPrice: first?.price.last ?? null,
    firstDate: first?.date ?? null,
  };
}

function contextFor(live: StockPrice | null, file: StockFile | null): RangeContext & { markSource: "live" | "file" | null } {
  const saved = fileMark(file);
  const last = live?.last ?? saved.last;
  return {
    last,
    yearLow: live?.yearLow ?? saved.yearLow,
    yearHigh: live?.yearHigh ?? saved.yearHigh,
    firstPrice: saved.firstPrice,
    firstDate: saved.firstDate,
    markSource: live?.last != null ? "live" : saved.last != null ? "file" : null,
  };
}

function namesFrom(files: StockFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.symbol, file.name]));
}

export async function loadPaperDesk(): Promise<PaperDesk> {
  const book = await readPaperBook();
  const summaries = await listStocks();
  const files = (await Promise.all(summaries.map((row) => readStock(row.symbol)))).filter((file): file is StockFile => file != null);
  const bySymbol = new Map(files.map((file) => [file.symbol, file]));
  const openSymbols = book.lots.filter((lot) => remainingQuantity(lot) > 0).map((lot) => lot.symbol);
  const symbols = [...new Set([...files.map((file) => file.symbol), ...openSymbols])];
  const quotes = await liveQuotes(symbols);
  const names = namesFrom(files);

  const research = files
    .map((file) => {
      const context = contextFor(quotes.get(file.symbol) ?? null, file);
      const percents = rangePercents(context);
      return { symbol: file.symbol, name: file.name, last: context.last, ...percents, lines: rangeLines(context) };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const openLots = book.lots.filter((lot) => remainingQuantity(lot) > 0);
  const marks: Record<string, number | null> = {};
  const open = openLots
    .map((lot) => {
      const context = contextFor(quotes.get(lot.symbol) ?? null, bySymbol.get(lot.symbol) ?? null);
      marks[lot.id] = context.last;
      const sinceEntry = context.last == null ? null : ((context.last - lot.entry) / lot.entry) * 100;
      const unrealised = context.last == null ? null : (context.last - lot.entry) * remainingQuantity(lot);
      return {
        id: lot.id,
        symbol: lot.symbol,
        name: names.get(lot.symbol) ?? null,
        quantity: remainingQuantity(lot),
        entry: lot.entry,
        openedOn: lot.openedOn,
        last: context.last,
        markSource: context.markSource,
        sinceEntry,
        unrealised: round2(unrealised),
        lines: rangeLines(context),
      };
    })
    .sort((a, b) => b.openedOn.localeCompare(a.openedOn) || a.symbol.localeCompare(b.symbol));

  const closed = book.lots
    .filter((lot) => remainingQuantity(lot) <= 0)
    .map((lot) => {
      const exit = averageExit(lot);
      const lastClose = lot.closes[lot.closes.length - 1];
      return {
        id: lot.id,
        symbol: lot.symbol,
        quantity: lot.quantity,
        entry: lot.entry,
        exit,
        openedOn: lot.openedOn,
        closedOn: lastClose?.closedOn ?? lot.openedOn,
        realised: round2(realisedPnl(lot)) ?? realisedPnl(lot),
        sinceEntry: exit == null ? null : ((exit - lot.entry) / lot.entry) * 100,
      };
    })
    .sort((a, b) => b.closedOn.localeCompare(a.closedOn) || a.symbol.localeCompare(b.symbol));

  return { summary: bookTotals(book.lots, marks), research, open, closed };
}

export async function paperBuy(symbol: string, quantity: number, price: number | null, now = new Date()): Promise<PaperDesk> {
  let entry = price;
  if (entry == null) {
    let quote: StockPrice;
    try {
      quote = await quoteEquity(symbol);
    } catch (error) {
      if (error instanceof StockError && error.code !== "source") throw error;
      throw new PaperError("quote", "The live print could not be read. Type an entry price to store the paper buy.");
    }
    if (quote.last == null) {
      throw new PaperError("quote", "The live print had no last price. Type an entry price to store the paper buy.");
    }
    entry = quote.last;
  } else {
    try {
      await quoteEquity(symbol);
    } catch (error) {
      if (error instanceof StockError && error.code !== "source") throw error;
      throw new PaperError("quote", "That symbol could not be confirmed on the NSE feed.");
    }
  }
  const book = buyLot(await readPaperBook(), {
    id: crypto.randomUUID(),
    symbol,
    quantity,
    entry,
    openedAt: now.toISOString(),
    openedOn: istDateStamp(now),
  });
  await writePaperBook(book);
  return loadPaperDesk();
}

export async function paperSell(id: string, now = new Date()): Promise<PaperDesk> {
  const book = await readPaperBook();
  const lot = book.lots.find((item) => item.id === id);
  if (!lot) throw new PaperError("not_found", "That paper lot is not on this desk.");
  if (remainingQuantity(lot) <= 0) throw new PaperError("invalid", "That paper lot is already closed.");
  let quote: StockPrice;
  try {
    quote = await quoteEquity(lot.symbol);
  } catch {
    throw new PaperError("quote", "The live print could not be read, so the paper sell was not recorded.");
  }
  if (quote.last == null) {
    throw new PaperError("quote", "The live print had no last price, so the paper sell was not recorded.");
  }
  await writePaperBook(
    sellLot(book, { id, price: quote.last, closedAt: now.toISOString(), closedOn: istDateStamp(now) }),
  );
  return loadPaperDesk();
}
