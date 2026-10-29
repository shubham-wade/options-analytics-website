import { round2 } from "@/lib/stocks/parse";

export class PaperError extends Error {
  constructor(
    readonly code: "invalid" | "not_found" | "quote",
    message: string,
  ) {
    super(message);
  }
}

export interface PaperClose {
  quantity: number;
  price: number;
  closedAt: string;
  closedOn: string;
}

export interface PaperLot {
  id: string;
  symbol: string;
  quantity: number;
  entry: number;
  openedAt: string;
  openedOn: string;
  closes: PaperClose[];
}

export interface PaperBook {
  lots: PaperLot[];
}

export function emptyBook(): PaperBook {
  return { lots: [] };
}

export function remainingQuantity(lot: PaperLot): number {
  const sold = lot.closes.reduce((sum, close) => sum + close.quantity, 0);
  return lot.quantity - sold;
}

export function realisedPnl(lot: PaperLot): number {
  return lot.closes.reduce((sum, close) => sum + (close.price - lot.entry) * close.quantity, 0);
}

export function averageExit(lot: PaperLot): number | null {
  const sold = lot.closes.reduce((sum, close) => sum + close.quantity, 0);
  if (sold <= 0) return null;
  const value = lot.closes.reduce((sum, close) => sum + close.price * close.quantity, 0);
  return round2(value / sold);
}

/** Percent move from `from` to `to`. A lower base of zero has no percent. */
export function percentChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export function buyLot(
  book: PaperBook,
  lot: { id: string; symbol: string; quantity: number; entry: number; openedAt: string; openedOn: string },
): PaperBook {
  const symbol = lot.symbol.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    throw new PaperError("invalid", "Use the NSE symbol, for example COLPAL.");
  }
  if (!Number.isInteger(lot.quantity) || lot.quantity < 1 || lot.quantity > 10_000_000) {
    throw new PaperError("invalid", "Quantity is a whole number of shares.");
  }
  if (!Number.isFinite(lot.entry) || lot.entry <= 0) {
    throw new PaperError("invalid", "Entry price has to be above zero.");
  }
  return {
    lots: [
      ...book.lots,
      {
        id: lot.id,
        symbol,
        quantity: lot.quantity,
        entry: round2(lot.entry) ?? lot.entry,
        openedAt: lot.openedAt,
        openedOn: lot.openedOn,
        closes: [],
      },
    ],
  };
}

/** Closes whatever shares of this lot are still open. */
export function sellLot(
  book: PaperBook,
  close: { id: string; price: number; closedAt: string; closedOn: string },
): PaperBook {
  if (!Number.isFinite(close.price) || close.price <= 0) {
    throw new PaperError("invalid", "Exit price has to be above zero.");
  }
  const lot = book.lots.find((item) => item.id === close.id);
  if (!lot) throw new PaperError("not_found", "That paper lot is not on this desk.");
  const remaining = remainingQuantity(lot);
  if (remaining <= 0) throw new PaperError("invalid", "That paper lot is already closed.");
  return {
    lots: book.lots.map((item) =>
      item.id === close.id
        ? {
            ...item,
            closes: [
              ...item.closes,
              { quantity: remaining, price: round2(close.price) ?? close.price, closedAt: close.closedAt, closedOn: close.closedOn },
            ],
          }
        : item,
    ),
  };
}

export interface RangeContext {
  last: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  firstPrice: number | null;
  firstDate: string | null;
}

export function rangePercents(context: RangeContext): { fromLow: number | null; fromHigh: number | null; sinceSaved: number | null } {
  return {
    fromLow: percentChange(context.yearLow, context.last),
    fromHigh: percentChange(context.yearHigh, context.last),
    sinceSaved: percentChange(context.firstPrice, context.last),
  };
}

function dayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function signedPercent(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value > 0) return `+${abs}%`;
  if (value < 0) return `−${abs}%`;
  return `${abs}%`;
}

/** Where the last price sits in the 52-week range, and since the first saved reading. */
export function rangeLines(context: RangeContext): string[] {
  const { fromLow, fromHigh, sinceSaved } = rangePercents(context);
  const lines: string[] = [];
  if (fromLow != null && fromHigh != null) {
    lines.push(`Last is ${signedPercent(fromLow)} from the 52-week low and ${signedPercent(fromHigh)} from the 52-week high.`);
  }
  if (fromHigh != null && fromHigh >= -5) {
    lines.push("Last is close to the 52-week high.");
  } else if (fromLow != null && fromLow >= 25) {
    lines.push("Last is already well above the 52-week low.");
  }
  if (context.firstDate && sinceSaved != null) {
    const when = dayLabel(context.firstDate);
    if (Math.abs(sinceSaved) < 0.05) lines.push(`The price is unchanged since the first saved reading on ${when}.`);
    else lines.push(`Since the first saved reading on ${when}, the price is ${signedPercent(sinceSaved)}.`);
  }
  return lines;
}

export function bookTotals(
  lots: PaperLot[],
  marks: Record<string, number | null>,
): { cost: number; marketValue: number | null; unrealised: number | null; realised: number } {
  let cost = 0;
  let marketValue = 0;
  let unrealised = 0;
  let realised = 0;
  let marksComplete = true;
  for (const lot of lots) {
    realised += realisedPnl(lot);
    const open = remainingQuantity(lot);
    if (open <= 0) continue;
    cost += lot.entry * open;
    const mark = marks[lot.id];
    if (mark == null || !Number.isFinite(mark)) {
      marksComplete = false;
      continue;
    }
    marketValue += mark * open;
    unrealised += (mark - lot.entry) * open;
  }
  return {
    cost: round2(cost) ?? cost,
    marketValue: marksComplete ? round2(marketValue) : null,
    unrealised: marksComplete ? round2(unrealised) : null,
    realised: round2(realised) ?? realised,
  };
}
