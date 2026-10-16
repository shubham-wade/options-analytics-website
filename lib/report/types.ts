export interface IndexPrint {
  name: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number;
  change: number;
  percentChange: number;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  /** (close − low) / (high − low). Null when the range is zero. */
  closingLocation: number | null;
  /** Open minus the previous close. */
  gap: number | null;
}

export interface VixPrint {
  close: number;
  previousClose: number;
  change: number;
  percentChange: number;
  regime: "low" | "moderate" | "elevated";
  regimeRule: string;
}

export interface SectorMove {
  name: string;
  percentChange: number;
}

export interface IndexContributor {
  symbol: string;
  /** Free-float weight at the previous close, in percent. */
  weight: number;
  percentChange: number;
  /** Estimated NIFTY points from this stock’s move. */
  points: number;
}

export interface IndexContribution {
  /** Sum of all constituent point estimates. */
  points: number;
  pullers: IndexContributor[];
  draggers: IndexContributor[];
}

export interface CashSession {
  date: string;
  fii: number;
  dii: number;
  combined: number;
}

export interface CashSummary {
  today: CashSession | null;
  fiveDay: { sessions: number; fii: number; dii: number; combined: number } | null;
  month: { label: string; sessions: number; fii: number; dii: number; combined: number } | null;
}

export type ParticipantName = "FII" | "DII" | "Pro" | "Client";

export interface ParticipantRow {
  name: ParticipantName;
  futureIndexLong: number;
  futureIndexShort: number;
  futureIndexLongChange: number | null;
  futureIndexShortChange: number | null;
  longRatio: number | null;
  longRatioChange: number | null;
  indexCallLong: number;
  indexPutLong: number;
  indexCallShort: number;
  indexPutShort: number;
}

export interface FuturesRead {
  priceChange: number;
  oi: number;
  oiChange: number | null;
  reading: string;
}

export interface StrikeOi {
  strike: number;
  oi: number;
  change: number;
}

export interface ExpiryChain {
  expiry: string;
  callOi: number;
  putOi: number;
  /** Put open interest ÷ call open interest. */
  pcr: number | null;
  callOiChange: number;
  putOiChange: number;
  atmStrike: number | null;
  atmIv: number | null;
  lowerPutIv: number | null;
  upperCallIv: number | null;
  topCalls: StrikeOi[];
  topPuts: StrikeOi[];
}

export interface VolatilityFile {
  daily: number | null;
  note: string;
}

export interface ScenarioPoint {
  move: number;
  pnl: number | null;
}

export interface PortfolioReport {
  connected: true;
  delta: number | null;
  gamma: number | null;
  thetaPerDay: number | null;
  vegaPerPoint: number | null;
  scenarios: ScenarioPoint[];
  ivUpPnl: number | null;
  ivDownPnl: number | null;
  ivPoints: number;
  largest: { symbol: string; delta: number | null; expiry: string | null }[];
  byExpiry: { expiry: string; contracts: number }[];
}

export interface EvidenceLists {
  supportive: string[];
  adverse: string[];
  inferred: string[];
}

export interface MarketReport {
  asOf: string;
  generatedAt: string;
  nifty: IndexPrint | null;
  bankNifty: IndexPrint | null;
  vix: VixPrint | null;
  sectors: SectorMove[];
  contributors: IndexContribution | null;
  cash: CashSummary;
  participants: ParticipantRow[];
  participantAsOf: string | null;
  participantPrevious: string | null;
  futures: FuturesRead | null;
  chains: ExpiryChain[];
  volatility: VolatilityFile | null;
  portfolio: PortfolioReport | null;
  evidence: EvidenceLists;
  gaps: string[];
  sources: { name: string; detail: string }[];
  /** False while a post-close file was still missing, so a later visit tries again. */
  settled?: boolean;
  lastAttemptAt?: string;
}
