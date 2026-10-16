import type { CashSummary, ExpiryChain, FuturesRead, IndexContribution, IndexContributor, IndexPrint, ParticipantName, ParticipantRow, StrikeOi, VixPrint } from "@/lib/report/types";
import { isTradingDay } from "@/lib/flows/fii-dii";

const PARTICIPANTS: Record<string, ParticipantName> = {
  FII: "FII",
  DII: "DII",
  Pro: "Pro",
  Client: "Client",
};

export function closingLocation(close: number, low: number, high: number): number | null {
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;
  return (close - low) / range;
}

export function vixRegime(close: number): VixPrint["regime"] {
  if (close < 13) return "low";
  if (close < 18) return "moderate";
  return "elevated";
}

export const VIX_REGIME_RULE = "Low is below 13, moderate is 13 up to 18, and elevated is 18 or higher. These cutoffs are local labels, not an exchange classification.";

export function futuresReading(priceChange: number, oiChange: number): string {
  const priceUp = priceChange > 0;
  const oiUp = oiChange > 0;
  if (priceChange === 0 || oiChange === 0) return "Price or open interest was unchanged, so the usual buildup reading does not apply.";
  if (priceUp && oiUp) return "Possible long buildup: the index rose while index-futures open interest rose.";
  if (!priceUp && oiUp) return "Possible short buildup: the index fell while index-futures open interest rose.";
  if (priceUp && !oiUp) return "Possible short covering: the index rose while index-futures open interest fell.";
  return "Possible long unwinding: the index fell while index-futures open interest fell.";
}

export function indexPrint(name: string, row: Record<string, unknown> | undefined): IndexPrint | null {
  if (!row) return null;
  const close = asNumber(row.last);
  const open = asNumber(row.open);
  const high = asNumber(row.high);
  const low = asNumber(row.low);
  const previousClose = asNumber(row.previousClose);
  const percentChange = asNumber(row.percentChange);
  if (close == null || open == null || high == null || low == null || previousClose == null || percentChange == null) return null;
  return {
    name,
    open,
    high,
    low,
    close,
    previousClose,
    change: close - previousClose,
    percentChange,
    advances: asNumber(row.advances),
    declines: asNumber(row.declines),
    unchanged: asNumber(row.unchanged),
    closingLocation: closingLocation(close, low, high),
    gap: open - previousClose,
  };
}

const ARCHIVE_INDEX: Record<string, string> = {
  "Nifty 50": "NIFTY 50",
  "Nifty Bank": "NIFTY BANK",
  "India VIX": "INDIA VIX",
  "Nifty Auto": "NIFTY AUTO",
  "Nifty IT": "NIFTY IT",
  "Nifty FMCG": "NIFTY FMCG",
  "Nifty Metal": "NIFTY METAL",
  "Nifty Pharma": "NIFTY PHARMA",
  "Nifty Realty": "NIFTY REALTY",
  "Nifty Energy": "NIFTY ENERGY",
  "Nifty Infrastructure": "NIFTY INFRA",
  "Nifty PSU Bank": "NIFTY PSU BANK",
  "Nifty Financial Services": "NIFTY FINANCIAL SERVICES",
  "Nifty Media": "NIFTY MEDIA",
  "Nifty Healthcare Index": "NIFTY HEALTHCARE",
};

/** NSE end-of-day index close file, mapped onto the same names the live feed uses. */
export function parseIndexClose(csv: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const name = ARCHIVE_INDEX[cells[0] ?? ""];
    const open = asNumber(cells[2]);
    const high = asNumber(cells[3]);
    const low = asNumber(cells[4]);
    const close = asNumber(cells[5]);
    const points = asNumber(cells[6]);
    const percentChange = asNumber(cells[7]);
    if (!name || open == null || high == null || low == null || close == null || points == null || percentChange == null) continue;
    map.set(name, {
      index: name,
      open,
      high,
      low,
      last: close,
      previousClose: close - points,
      percentChange,
    });
  }
  return map;
}

export function indexContributors(body: unknown, limit = 10): IndexContribution | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return null;
  const index = data.find((row) => row && typeof row === "object" && (row as { symbol?: unknown }).symbol === "NIFTY 50") as Record<string, unknown> | undefined;
  const indexPrevious = index ? asNumber(index.previousClose) : null;
  if (indexPrevious == null || indexPrevious <= 0) return null;

  const stocks = data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const symbol = typeof record.symbol === "string" ? record.symbol : "";
    const last = asNumber(record.lastPrice);
    const previous = asNumber(record.previousClose);
    const ffmc = asNumber(record.ffmc);
    if (!symbol || symbol === "NIFTY 50" || last == null || last <= 0 || previous == null || previous <= 0 || ffmc == null || ffmc <= 0) return [];
    return [{ symbol, last, previous, ffmc, previousFfmc: ffmc * previous / last }];
  });
  const previousTotal = stocks.reduce((sum, stock) => sum + stock.previousFfmc, 0);
  if (stocks.length < 2 || previousTotal <= 0) return null;

  const divisor = previousTotal / indexPrevious;
  const ranked: IndexContributor[] = stocks.map((stock) => ({
    symbol: stock.symbol,
    weight: stock.previousFfmc / previousTotal * 100,
    percentChange: (stock.last - stock.previous) / stock.previous * 100,
    points: (stock.ffmc - stock.previousFfmc) / divisor,
  }));
  return {
    points: ranked.reduce((sum, stock) => sum + stock.points, 0),
    pullers: ranked.filter((stock) => stock.points > 0).sort((left, right) => right.points - left.points).slice(0, limit),
    draggers: ranked.filter((stock) => stock.points < 0).sort((left, right) => left.points - right.points).slice(0, limit),
  };
}

export function vixPrint(row: Record<string, unknown> | undefined): VixPrint | null {
  if (!row) return null;
  const close = asNumber(row.last);
  const previousClose = asNumber(row.previousClose);
  const percentChange = asNumber(row.percentChange);
  if (close == null || previousClose == null || percentChange == null) return null;
  return {
    close,
    previousClose,
    change: close - previousClose,
    percentChange,
    regime: vixRegime(close),
    regimeRule: VIX_REGIME_RULE,
  };
}

interface RawParticipant {
  futureIndexLong: number;
  futureIndexShort: number;
  indexCallLong: number;
  indexPutLong: number;
  indexCallShort: number;
  indexPutShort: number;
}

export function parseParticipantOi(csv: string): { asOf: string | null; rows: Record<ParticipantName, RawParticipant>; indexFutureOi: number | null } {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.startsWith("Client Type"));
  const rows = {} as Record<ParticipantName, RawParticipant>;
  if (headerIndex < 0) return { asOf: null, rows, indexFutureOi: null };
  let indexFutureOi: number | null = null;
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    const name = PARTICIPANTS[cells[0] ?? ""];
    const values = cells.slice(1).map((cell) => asNumber(cell));
    if (cells[0] === "TOTAL") {
      indexFutureOi = values[0];
      continue;
    }
    if (!name || values.some((value) => value == null)) continue;
    rows[name] = {
      futureIndexLong: values[0] as number,
      futureIndexShort: values[1] as number,
      indexCallLong: values[4] as number,
      indexPutLong: values[5] as number,
      indexCallShort: values[6] as number,
      indexPutShort: values[7] as number,
    };
  }
  const title = lines[0] ?? "";
  const dated = /as on ([A-Za-z]{3} \d{1,2}, \d{4})/.exec(title.replace(/"/g, ""));
  return { asOf: dated?.[1] ?? null, rows, indexFutureOi };
}

export function participantRows(
  today: Record<ParticipantName, RawParticipant>,
  previous: Record<ParticipantName, RawParticipant> | null,
): ParticipantRow[] {
  return (["FII", "DII", "Pro", "Client"] as const).flatMap((name) => {
    const row = today[name];
    if (!row) return [];
    const prior = previous?.[name];
    const ratio = longRatio(row.futureIndexLong, row.futureIndexShort);
    const priorRatio = prior ? longRatio(prior.futureIndexLong, prior.futureIndexShort) : null;
    return [{
      name,
      futureIndexLong: row.futureIndexLong,
      futureIndexShort: row.futureIndexShort,
      futureIndexLongChange: prior ? row.futureIndexLong - prior.futureIndexLong : null,
      futureIndexShortChange: prior ? row.futureIndexShort - prior.futureIndexShort : null,
      longRatio: ratio,
      longRatioChange: ratio != null && priorRatio != null ? ratio - priorRatio : null,
      indexCallLong: row.indexCallLong,
      indexPutLong: row.indexPutLong,
      indexCallShort: row.indexCallShort,
      indexPutShort: row.indexPutShort,
    }];
  });
}

export function longRatio(longs: number, shorts: number): number | null {
  const total = longs + shorts;
  if (!Number.isFinite(total) || total <= 0) return null;
  return longs / total;
}

export function summarizeChain(expiry: string, payload: unknown, spot: number | null): ExpiryChain | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { records?: { data?: unknown } }).records?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  let callOi = 0;
  let putOi = 0;
  let callOiChange = 0;
  let putOiChange = 0;
  const strikes: { strike: number; callOi: number; putOi: number; callChange: number; putChange: number; callIv: number | null; putIv: number | null }[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { strikePrice?: unknown; CE?: unknown; PE?: unknown };
    const strike = asNumber(record.strikePrice);
    if (strike == null) continue;
    const call = leg(record.CE);
    const put = leg(record.PE);
    callOi += call.oi;
    putOi += put.oi;
    callOiChange += call.change;
    putOiChange += put.change;
    strikes.push({ strike, callOi: call.oi, putOi: put.oi, callChange: call.change, putChange: put.change, callIv: call.iv, putIv: put.iv });
  }
  if (strikes.length === 0) return null;
  const atm = spot == null ? null : strikes.reduce((best, row) => (Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best));
  const lower = spot == null ? null : nearest(strikes, spot * 0.98);
  const upper = spot == null ? null : nearest(strikes, spot * 1.02);
  const atmIv = atm && atm.callIv != null && atm.putIv != null ? (atm.callIv + atm.putIv) / 2 : atm?.callIv ?? atm?.putIv ?? null;
  return {
    expiry,
    callOi,
    putOi,
    pcr: callOi > 0 ? putOi / callOi : null,
    callOiChange,
    putOiChange,
    atmStrike: atm?.strike ?? null,
    atmIv,
    lowerPutIv: lower?.putIv ?? null,
    upperCallIv: upper?.callIv ?? null,
    topCalls: topStrikes(strikes.map((row) => ({ strike: row.strike, oi: row.callOi, change: row.callChange }))),
    topPuts: topStrikes(strikes.map((row) => ({ strike: row.strike, oi: row.putOi, change: row.putChange }))),
  };
}

export function buildFuturesRead(priceChange: number | null, todayOi: number | null, previousOi: number | null): FuturesRead | null {
  if (priceChange == null || todayOi == null) return null;
  const oiChange = previousOi == null ? null : todayOi - previousOi;
  return {
    priceChange,
    oi: todayOi,
    oiChange,
    reading: oiChange == null ? "Yesterday’s open interest was not available, so the buildup reading is left blank." : futuresReading(priceChange, oiChange),
  };
}

export function summarizeCash(asOf: string, entries: Record<string, { fii: number; dii: number }>): CashSummary {
  const dated = Object.entries(entries)
    .filter(([date, row]) => date <= asOf && isTradingDay(date) && Number.isFinite(row.fii) && Number.isFinite(row.dii))
    .sort(([left], [right]) => left.localeCompare(right));
  const session = (date: string, row: { fii: number; dii: number }) => ({ date, fii: row.fii, dii: row.dii, combined: row.fii + row.dii });
  const todayRow = dated.find(([date]) => date === asOf);
  const lastFive = dated.slice(-5);
  const monthRows = dated.filter(([date]) => date.slice(0, 7) === asOf.slice(0, 7));
  const sum = (rows: [string, { fii: number; dii: number }][]) => rows.reduce((total, [, row]) => ({
    fii: total.fii + row.fii,
    dii: total.dii + row.dii,
    combined: total.combined + row.fii + row.dii,
  }), { fii: 0, dii: 0, combined: 0 });
  const [year, month] = asOf.split("-");
  const monthLabel = new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    today: todayRow ? session(todayRow[0], todayRow[1]) : null,
    fiveDay: lastFive.length > 0 ? { sessions: lastFive.length, ...sum(lastFive) } : null,
    month: monthRows.length > 0 ? { label: monthLabel, sessions: monthRows.length, ...sum(monthRows) } : null,
  };
}

export function evidenceFrom(input: {
  nifty: IndexPrint | null;
  cashFii: number | null;
  cashDii: number | null;
  fiiLongRatio: number | null;
  fiiRatioChange: number | null;
  pcr: number | null;
  vixChange: number | null;
  futuresReading: string | null;
}): { supportive: string[]; adverse: string[]; inferred: string[] } {
  const supportive: string[] = [];
  const adverse: string[] = [];
  const inferred: string[] = [];
  if (input.nifty && input.nifty.change > 0) supportive.push(`NIFTY closed up ${input.nifty.change.toFixed(2)} points.`);
  if (input.nifty && input.nifty.change < 0) adverse.push(`NIFTY closed down ${Math.abs(input.nifty.change).toFixed(2)} points.`);
  if (input.nifty?.closingLocation != null && input.nifty.closingLocation >= 0.66) supportive.push("NIFTY finished in the top third of the day’s range.");
  if (input.nifty?.closingLocation != null && input.nifty.closingLocation <= 0.34) adverse.push("NIFTY finished in the bottom third of the day’s range.");
  if (input.cashFii != null && input.cashFii > 0) supportive.push("FII cash flow was net buying.");
  if (input.cashFii != null && input.cashFii < 0) adverse.push("FII cash flow was net selling.");
  if (input.cashDii != null && input.cashDii > 0) supportive.push("DII cash flow was net buying.");
  if (input.cashDii != null && input.cashDii < 0) adverse.push("DII cash flow was net selling.");
  if (input.vixChange != null && input.vixChange < 0) supportive.push("India VIX fell.");
  if (input.vixChange != null && input.vixChange > 0) adverse.push("India VIX rose.");
  if (input.fiiRatioChange != null && input.fiiRatioChange > 0) supportive.push("The FII index-futures long ratio rose versus the previous session.");
  if (input.fiiRatioChange != null && input.fiiRatioChange < 0) adverse.push("The FII index-futures long ratio fell versus the previous session.");
  if (input.futuresReading) inferred.push(input.futuresReading);
  if (input.pcr != null) inferred.push(`Nearest-expiry put-call ratio is ${input.pcr.toFixed(2)}, using put open interest divided by call open interest. A high or low ratio is context, not a signal by itself.`);
  if (input.fiiLongRatio != null && input.fiiLongRatio < 0.4) inferred.push("FII index-futures contracts are mostly short. That describes the book, not the next session’s direction.");
  return { supportive, adverse, inferred };
}

function topStrikes(rows: StrikeOi[]): StrikeOi[] {
  return [...rows].sort((left, right) => right.oi - left.oi).slice(0, 3);
}

function nearest<T extends { strike: number }>(rows: T[], target: number): T {
  return rows.reduce((best, row) => (Math.abs(row.strike - target) < Math.abs(best.strike - target) ? row : best));
}

function leg(value: unknown): { oi: number; change: number; iv: number | null } {
  if (!value || typeof value !== "object") return { oi: 0, change: 0, iv: null };
  const record = value as { openInterest?: unknown; changeinOpenInterest?: unknown; impliedVolatility?: unknown };
  const iv = asNumber(record.impliedVolatility);
  return {
    oi: asNumber(record.openInterest) ?? 0,
    change: asNumber(record.changeinOpenInterest) ?? 0,
    iv: iv != null && iv > 0 ? iv : null,
  };
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
