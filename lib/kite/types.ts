/**
 * Structural copies of the Kite Connect response fields this app reads.
 * Names match the official portfolio, instrument and quote schemas.
 */

export interface KiteNetPosition {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: string;
  quantity: number;
  overnight_quantity: number;
  multiplier: number;
  average_price: number;
  close_price: number;
  last_price: number;
  value: number;
  pnl: number;
  m2m: number;
  unrealised: number;
  realised: number;
  buy_quantity: number;
  buy_price: number;
  buy_value: number;
  buy_m2m: number;
  day_buy_quantity: number;
  day_buy_price: number;
  day_buy_value: number;
  sell_quantity: number;
  sell_price: number;
  sell_value: number;
  sell_m2m: number;
  day_sell_quantity: number;
  day_sell_price: number;
  day_sell_value: number;
}

export interface KitePositionsResponse {
  net: KiteNetPosition[];
  day: KiteNetPosition[];
}

export interface KiteInstrument {
  instrument_token: string | number;
  exchange_token?: string | number;
  tradingsymbol: string;
  name: string;
  last_price?: number;
  expiry?: Date | string | null;
  strike: number | string;
  tick_size?: number | string;
  lot_size?: number | string;
  instrument_type: string;
  segment?: string;
  exchange: string;
}

export interface KiteDepthLevel {
  price?: number;
  quantity?: number;
  orders?: number;
}

export interface KiteQuote {
  instrument_token?: number;
  timestamp?: string | null;
  last_trade_time?: string | null;
  last_price?: number;
  volume?: number;
  average_price?: number;
  buy_quantity?: number;
  sell_quantity?: number;
  oi?: number;
  last_quantity?: number;
  ohlc?: { open?: number; high?: number; low?: number; close?: number };
  net_change?: number;
  lower_circuit_limit?: number;
  upper_circuit_limit?: number;
  oi_day_high?: number;
  oi_day_low?: number;
  depth?: {
    buy?: KiteDepthLevel[];
    sell?: KiteDepthLevel[];
  };
}

export interface KiteSessionData {
  user_id: string;
  user_name: string;
  user_shortname: string;
  access_token: string;
  login_time: string;
}

export type QuoteQuality = "live" | "delayed" | "stale" | "market-closed" | "unavailable";
export type PremiumSource = "mid" | "ltp" | "none";

export interface PremiumObservation {
  price: number | null;
  source: PremiumSource;
  quality: QuoteQuality;
  bid: number | null;
  ask: number | null;
  ltp: number | null;
  previousClose: number | null;
  exchangeTimestamp: string | null;
  lastTradeTime: string | null;
  warnings: string[];
}

export interface ParsedNiftyOption {
  underlying: "NIFTY";
  strike: number;
  optionType: "CE" | "PE";
  expiry: Date | null;
  expiryPrecision: "day" | "month" | "unknown";
  /** Four-digit year taken from the symbol. */
  contractYear: number;
  /** Calendar month index, January is 0. */
  contractMonth: number;
}

export interface MappedOptionPosition {
  id: string;
  exchange: string;
  tradingSymbol: string;
  instrumentToken: number;
  underlying: string;
  strike: number | null;
  expiry: string | null;
  expiryEpochMs: number | null;
  optionType: "CE" | "PE";
  quantity: number;
  side: "long" | "short";
  multiplier: number;
  lotSize: number | null;
  tickSize: number | null;
  averagePrice: number | null;
  brokerLastPrice: number | null;
  brokerUnrealised: number | null;
  brokerRealised: number | null;
  brokerPnl: number | null;
  /** P&L since the previous close, including today's buys and sells. */
  brokerDayPnl: number | null;
  product: string;
  metadataSource: "instrument-master" | "symbol";
  warnings: string[];
}
