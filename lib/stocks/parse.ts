import type {
  StockChange,
  StockFundamentals,
  StockHolding,
  StockPrice,
  StockQuarter,
  StockSnapshot,
  StockYear,
} from "@/lib/stocks/types";

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function publishedNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/₹/g, "").replace(/,/g, "").replace(/%/g, "").replace(/cr/gi, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function quarterRank(label: string): number {
  const match = /^([A-Za-z]{3}) '(\d{2})$/.exec(label.trim());
  if (!match) return 0;
  const month = MONTHS[match[1]] ?? 0;
  return (2000 + Number(match[2])) * 12 + month;
}

function numberMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

function statementByTitle(statements: unknown, title: string): Record<string, unknown> | null {
  if (!Array.isArray(statements)) return null;
  for (const item of statements) {
    const record = asRecord(item);
    if (record?.title === title) return record;
  }
  return null;
}

function percentSum(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  let total = 0;
  let seen = false;
  for (const raw of Object.values(record)) {
    const nested = asRecord(raw);
    const percent = nested ? publishedNumber(nested.percent) : publishedNumber(raw);
    if (percent == null) continue;
    total += percent;
    seen = true;
  }
  return seen ? total : null;
}

function holdingPercent(quarter: Record<string, unknown>, key: string): number | null {
  const node = quarter[key];
  const record = asRecord(node);
  if (record && "percent" in record) return publishedNumber(record.percent);
  return percentSum(node);
}

function oneHolding(quarter: string, row: Record<string, unknown>): StockHolding {
  return {
    quarter,
    promoter: round2(percentSum(row.promoters)),
    mutualFunds: round2(holdingPercent(row, "mutualFunds")),
    insurance: round2(
      percentSum(asRecord(row.otherDomesticInstitutions)?.insurance ?? null) ??
        holdingPercent(asRecord(row.otherDomesticInstitutions) ?? {}, "insurance"),
    ),
    foreignInstitutions: round2(holdingPercent(row, "foreignInstitutions")),
    retailAndOthers: round2(holdingPercent(row, "retailAndOthers")),
  };
}

/** Published quarters, oldest first. */
export function parseHoldings(pattern: unknown): StockHolding[] {
  const record = asRecord(pattern);
  if (!record) return [];
  return Object.keys(record)
    .sort((a, b) => quarterRank(a) - quarterRank(b))
    .flatMap((quarter) => {
      const row = asRecord(record[quarter]);
      return row ? [oneHolding(quarter, row)] : [];
    });
}

export function parseHolding(pattern: unknown): StockHolding | null {
  const holdings = parseHoldings(pattern);
  return holdings[holdings.length - 1] ?? null;
}

const HOLDING_GROUPS = [
  ["Promoter", "promoter"],
  ["Foreign institutions", "foreignInstitutions"],
  ["Mutual funds", "mutualFunds"],
  ["Insurance", "insurance"],
  ["Retail and others", "retailAndOthers"],
] as const;

function holdingLine(
  label: string,
  from: number,
  to: number,
  fromQuarter: string,
  toQuarter: string,
  extra = "",
): StockChange | null {
  const delta = to - from;
  if (Math.abs(delta) < 0.005 && !extra) return null;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const word = delta > 0 ? "rose" : delta < 0 ? "fell" : "was unchanged";
  const move = Math.abs(delta) < 0.005
    ? `${label} was unchanged at ${to.toFixed(2)}% from ${fromQuarter} to ${toQuarter}`
    : `${label} ${word} from ${from.toFixed(2)}% in ${fromQuarter} to ${to.toFixed(2)}% in ${toQuarter} (${signed(delta, 2)} pp)`;
  return { label, direction, text: `${move}${extra}.` };
}

function turningPoint(holdings: StockHolding[], key: (typeof HOLDING_GROUPS)[number][1], first: number, last: number): string {
  let peak: { quarter: string; value: number } | null = null;
  let trough: { quarter: string; value: number } | null = null;
  for (const row of holdings) {
    const value = row[key];
    if (value == null) continue;
    if (!peak || value > peak.value) peak = { quarter: row.quarter, value };
    if (!trough || value < trough.value) trough = { quarter: row.quarter, value };
  }
  const extras: string[] = [];
  if (peak && peak.value > first + 0.05 && peak.value > last + 0.05) {
    extras.push(`. It peaked at ${peak.value.toFixed(2)}% in ${peak.quarter}`);
  }
  if (trough && trough.value < first - 0.05 && trough.value < last - 0.05) {
    extras.push(`. It bottomed at ${trough.value.toFixed(2)}% in ${trough.quarter}`);
  }
  return extras.join("");
}

/** How each group moved from the previous published quarter to the latest one. */
export function holdingMoves(holdings: StockHolding[]): StockChange[] {
  if (holdings.length < 2) return [];
  const older = holdings[holdings.length - 2];
  const newer = holdings[holdings.length - 1];
  return HOLDING_GROUPS.flatMap(([label, key]) => {
    const from = older[key];
    const to = newer[key];
    if (from == null || to == null) return [];
    const line = holdingLine(label, from, to, older.quarter, newer.quarter);
    return line ? [line] : [];
  });
}

/** How each group moved from the earliest quarter on the file to the latest one. */
export function holdingSpan(holdings: StockHolding[]): StockChange[] {
  if (holdings.length < 2) return [];
  const first = holdings[0];
  const last = holdings[holdings.length - 1];
  return HOLDING_GROUPS.flatMap(([label, key]) => {
    const from = first[key];
    const to = last[key];
    if (from == null || to == null) return [];
    const line = holdingLine(label, from, to, first.quarter, last.quarter, turningPoint(holdings, key, from, to));
    return line ? [line] : [];
  });
}

export function parseFundamentals(rows: unknown): StockFundamentals {
  const byName = new Map<string, number | null>();
  if (Array.isArray(rows)) {
    for (const item of rows) {
      const record = asRecord(item);
      if (!record || typeof record.name !== "string") continue;
      byName.set(record.name, publishedNumber(record.value));
    }
  }
  return {
    marketCapCrore: byName.get("Market Cap") ?? null,
    pe: byName.get("P/E Ratio(TTM)") ?? null,
    industryPe: byName.get("Industry P/E") ?? null,
    eps: byName.get("EPS(TTM)") ?? null,
    pb: byName.get("P/B Ratio") ?? null,
    roe: byName.get("ROE") ?? null,
    debtToEquity: byName.get("Debt to Equity") ?? null,
    bookValue: byName.get("Book Value") ?? null,
    dividendYield: byName.get("Dividend Yield") ?? null,
    faceValue: byName.get("Face Value") ?? null,
  };
}

export function parseStatements(statements: unknown): { years: StockYear[]; quarters: StockQuarter[] } {
  const revenue = statementByTitle(statements, "Revenue");
  const profit = statementByTitle(statements, "Profit");
  const netWorth = statementByTitle(statements, "Net Worth");
  const revenueYear = numberMap(revenue?.yearly);
  const profitYear = numberMap(profit?.yearly);
  const worthYear = numberMap(netWorth?.yearly);
  const years = [...new Set([...Object.keys(revenueYear), ...Object.keys(profitYear), ...Object.keys(worthYear)])]
    .sort()
    .map((year) => ({
      year,
      revenue: revenueYear[year] ?? null,
      profit: profitYear[year] ?? null,
      netWorth: worthYear[year] ?? null,
    }));
  const revenueQuarter = numberMap(revenue?.quarterly);
  const profitQuarter = numberMap(profit?.quarterly);
  const quarters = [...new Set([...Object.keys(revenueQuarter), ...Object.keys(profitQuarter)])]
    .sort((a, b) => quarterRank(a) - quarterRank(b))
    .map((quarter) => ({
      quarter,
      revenue: revenueQuarter[quarter] ?? null,
      profit: profitQuarter[quarter] ?? null,
    }));
  return { years, quarters };
}

export function parseLivePrice(body: unknown, yearHigh: number | null, yearLow: number | null): StockPrice {
  const record = asRecord(body) ?? {};
  const last = publishedNumber(record.ltp);
  const change = publishedNumber(record.dayChange);
  const previous = last != null && change != null ? last - change : publishedNumber(record.close);
  return {
    last: round2(last),
    change: round2(change),
    changePercent: round2(publishedNumber(record.dayChangePerc)),
    open: round2(publishedNumber(record.open)),
    high: round2(publishedNumber(record.high)),
    low: round2(publishedNumber(record.low)),
    previousClose: round2(previous),
    volume: publishedNumber(record.volume),
    average: null,
    averageSource: null,
    yearHigh: publishedNumber(record.yearHighPrice) ?? yearHigh,
    yearLow: publishedNumber(record.yearLowPrice) ?? yearLow,
    source: "groww",
  };
}

/** Volume-weighted price of intraday minute bars. Typical price is (high + low + close) / 3. */
export function averageFromMinuteBars(body: unknown): number | null {
  const chart = asRecord(asRecord(body)?.chart);
  const result = chart?.result;
  const first = Array.isArray(result) ? asRecord(result[0]) : null;
  const quotes = asRecord(first?.indicators)?.quote;
  const quote = Array.isArray(quotes) ? asRecord(quotes[0]) : null;
  if (!quote) return null;
  const high = quote.high;
  const low = quote.low;
  const close = quote.close;
  const volume = quote.volume;
  if (!Array.isArray(high) || !Array.isArray(low) || !Array.isArray(close) || !Array.isArray(volume)) return null;
  let traded = 0;
  let volumeSum = 0;
  for (let index = 0; index < close.length; index += 1) {
    const barHigh = high[index];
    const barLow = low[index];
    const barClose = close[index];
    const barVolume = volume[index];
    if (
      typeof barHigh !== "number" ||
      typeof barLow !== "number" ||
      typeof barClose !== "number" ||
      typeof barVolume !== "number" ||
      barVolume <= 0
    ) {
      continue;
    }
    traded += ((barHigh + barLow + barClose) / 3) * barVolume;
    volumeSum += barVolume;
  }
  if (volumeSum <= 0) return null;
  return round2(traded / volumeSum);
}

export function companyIdentity(body: unknown): {
  name: string;
  isin: string | null;
  industry: string | null;
  yearHigh: number | null;
  yearLow: number | null;
} {
  const record = asRecord(body) ?? {};
  const details = asRecord(record.details);
  const header = asRecord(record.header);
  const priceData = asRecord(asRecord(record.priceData)?.nse);
  const name = typeof details?.fullName === "string" ? details.fullName : "Unknown";
  return {
    name,
    isin: typeof header?.isin === "string" ? header.isin : null,
    industry: typeof header?.industryName === "string" ? header.industryName : null,
    yearHigh: publishedNumber(priceData?.yearHighPrice),
    yearLow: publishedNumber(priceData?.yearLowPrice),
  };
}

function statementsHaveNumbers(statements: unknown): boolean {
  if (!Array.isArray(statements)) return false;
  return statements.some((item) => {
    const record = asRecord(item);
    if (!record) return false;
    return Object.keys(numberMap(record.yearly)).length > 0 || Object.keys(numberMap(record.quarterly)).length > 0;
  });
}

/** Consolidated figures when that series has numbers. Otherwise the standalone series. */
export function publishedStatements(body: unknown): { accounts: "consolidated" | "standalone"; statements: unknown } {
  const book = asRecord(asRecord(body)?.financialStatementV2);
  const consolidated = book?.CONSOLIDATED ?? null;
  if (statementsHaveNumbers(consolidated)) return { accounts: "consolidated", statements: consolidated };
  return { accounts: "standalone", statements: book?.STANDALONE ?? null };
}

function signed(value: number, digits: number): string {
  const abs = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

function line(
  label: string,
  older: number | null,
  newer: number | null,
  unit: string,
  digits: number,
): StockChange | null {
  if (older == null || newer == null) return null;
  const delta = newer - older;
  if (Math.abs(delta) < 0.005) return null;
  const direction = delta > 0 ? "up" : "down";
  const word = delta > 0 ? "higher" : "lower";
  return {
    label,
    direction,
    text: `${label} is ${signed(delta, digits)}${unit} ${word} than the previous saved reading (${signed(older, digits)}${unit} to ${signed(newer, digits)}${unit}).`,
  };
}

export function compareSnapshots(older: StockSnapshot, newer: StockSnapshot): StockChange[] {
  const changes: Array<StockChange | null> = [
    line("Price", older.price.last, newer.price.last, "", 2),
    line("P/E", older.fundamentals.pe, newer.fundamentals.pe, "", 2),
    line("ROE", older.fundamentals.roe, newer.fundamentals.roe, "%", 2),
    line("Debt to equity", older.fundamentals.debtToEquity, newer.fundamentals.debtToEquity, "", 2),
    line("Book value", older.fundamentals.bookValue, newer.fundamentals.bookValue, "", 2),
    line("EPS", older.fundamentals.eps, newer.fundamentals.eps, "", 2),
  ];
  const previous = older.holding;
  const current = newer.holding;
  if (previous && current) {
    changes.push(
      line("Promoter holding", previous.promoter, current.promoter, " pp", 2),
      line("Foreign institutions", previous.foreignInstitutions, current.foreignInstitutions, " pp", 2),
      line("Mutual funds", previous.mutualFunds, current.mutualFunds, " pp", 2),
    );
  }
  return changes.filter((item): item is StockChange => item != null);
}
