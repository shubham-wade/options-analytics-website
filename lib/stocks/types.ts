export interface StockPrice {
  last: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  /** Day’s average traded price. Kite sends the exchange average; otherwise it is the volume-weighted price of today’s minute bars. */
  average: number | null;
  averageSource: "kite" | "bars" | null;
  yearHigh: number | null;
  yearLow: number | null;
  /** Where the last price came from. Fundamentals still come from the company filing feed. */
  source: "groww" | "kite";
}

export interface StockFundamentals {
  marketCapCrore: number | null;
  pe: number | null;
  industryPe: number | null;
  eps: number | null;
  pb: number | null;
  roe: number | null;
  debtToEquity: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  faceValue: number | null;
}

export interface StockHolding {
  quarter: string;
  promoter: number | null;
  mutualFunds: number | null;
  insurance: number | null;
  foreignInstitutions: number | null;
  retailAndOthers: number | null;
}

export interface StockYear {
  year: string;
  revenue: number | null;
  profit: number | null;
  netWorth: number | null;
}

export interface StockQuarter {
  quarter: string;
  revenue: number | null;
  profit: number | null;
}

export interface StockSnapshot {
  /** Asia/Kolkata calendar day this reading was saved. One reading per day. */
  date: string;
  savedAt: string;
  price: StockPrice;
  fundamentals: StockFundamentals;
  /** Newest published quarter, kept for the day-to-day comparison. */
  holding: StockHolding | null;
  /** Published quarters, oldest first. */
  holdings: StockHolding[];
  years: StockYear[];
  quarters: StockQuarter[];
  /** Which Groww series supplied revenue, profit, and net worth. Older files omit this and were consolidated. */
  accounts?: "consolidated" | "standalone";
}

export interface StockChange {
  label: string;
  direction: "up" | "down" | "flat";
  text: string;
}

export interface StockFile {
  symbol: string;
  name: string;
  isin: string | null;
  industry: string | null;
  exchange: "NSE";
  searchId: string;
  /** Newest reading last. */
  snapshots: StockSnapshot[];
}

export interface StockSummary {
  symbol: string;
  name: string;
  industry: string | null;
  savedOn: string | null;
  price: number | null;
  changePercent: number | null;
  readings: number;
}
