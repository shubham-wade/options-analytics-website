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

export interface StockProfile {
  foundedYear: number | null;
  businessSummary: string | null;
}

export interface StockGrowth {
  /** Trailing one-year growth, in percent. */
  revenueOneYear: number | null;
  /** Three-year compound growth, in percent. */
  revenueThreeYear: number | null;
  profitOneYear: number | null;
  profitThreeYear: number | null;
}

export interface StockPeer {
  symbol: string;
  name: string;
  marketCapCrore: number | null;
  pe: number | null;
  pb: number | null;
}

export interface StockNewsItem {
  publishedAt: string;
  source: string;
  title: string;
  /** Article or filing URL from the Groww headline, when present. */
  url: string | null;
}

export interface StockDividend {
  /** Ex date, YYYY-MM-DD. */
  exDate: string;
  amount: number;
  kind: string | null;
}

export interface StockResultDate {
  date: string;
  title: string;
}

export interface StockNote {
  heading: string;
  text: string;
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
  profile?: StockProfile | null;
  growth?: StockGrowth | null;
  peers?: StockPeer[];
  news?: StockNewsItem[];
  dividends?: StockDividend[];
  results?: StockResultDate[];
  /** Sentences drawn from this snapshot. Not a buy or sell call. */
  notes?: StockNote[];
}

export interface StockChange {
  label: string;
  direction: "up" | "down" | "flat";
  text: string;
}

/** User highlight on a saved file. Green to red. Not a buy or sell call. */
export const STOCK_HIGHLIGHTS = ["green", "lime", "amber", "orange", "red"] as const;
export type StockHighlight = (typeof STOCK_HIGHLIGHTS)[number];
export const HIGHLIGHT_HEX: Record<StockHighlight, string> = {
  green: "#10b981",
  lime: "#a3e635",
  amber: "#fbbf24",
  orange: "#f97316",
  red: "#f43f5e",
};

/** Trailing P/E across listed history. Current P/E stays on the latest snapshot. */
export interface StockPeHistory {
  median: number | null;
  high: number | null;
  samples: number;
  asOf: string | null;
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
  highlight?: StockHighlight | null;
  /** Owner notes on this file. Kept across snapshot saves. Not a buy or sell call. */
  comment?: string | null;
  /** Median and all-time high trailing P/E from listed history. Kept across snapshot saves. */
  pe?: StockPeHistory | null;
}

export interface StockSummary {
  symbol: string;
  name: string;
  industry: string | null;
  savedOn: string | null;
  price: number | null;
  changePercent: number | null;
  /** Last versus the 52-week high. Negative when the print is below that high. */
  fromHighPercent: number | null;
  pe: number | null;
  peHigh: number | null;
  peMedian: number | null;
  readings: number;
  highlight?: StockHighlight | null;
}
