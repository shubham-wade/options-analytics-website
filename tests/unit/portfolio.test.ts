import { describe, expect, it } from "vitest";
import { loadPortfolio } from "@/lib/kite/portfolio";
import type { KiteInstrument, KiteNetPosition, KiteQuote } from "@/lib/kite/types";
import { istWallTimeToUtc } from "@/lib/time";

function position(overrides: Partial<KiteNetPosition> = {}): KiteNetPosition {
  return {
    tradingsymbol: "NIFTY25OCT24200CE",
    exchange: "NFO",
    instrument_token: 11,
    product: "NRML",
    quantity: 75,
    overnight_quantity: 0,
    multiplier: 1,
    average_price: 150,
    close_price: 140,
    last_price: 999,
    value: 0,
    pnl: 100,
    m2m: 20,
    unrealised: 80,
    realised: 20,
    buy_quantity: 75,
    buy_price: 150,
    buy_value: 11250,
    buy_m2m: 11250,
    day_buy_quantity: 75,
    day_buy_price: 150,
    day_buy_value: 11250,
    sell_quantity: 0,
    sell_price: 0,
    sell_value: 0,
    sell_m2m: 0,
    day_sell_quantity: 0,
    day_sell_price: 0,
    day_sell_value: 0,
    ...overrides,
  };
}

describe("portfolio assembly", () => {
  it("prices from the quote, not the instrument master last price, and ignores the day book", async () => {
    const now = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);
    const nfo: KiteInstrument[] = [
      {
        instrument_token: "11",
        tradingsymbol: "NIFTY25OCT24200CE",
        name: "NIFTY",
        expiry: new Date("2026-10-28"),
        strike: 24200,
        lot_size: 75,
        instrument_type: "CE",
        exchange: "NFO",
        last_price: 1,
      },
    ];
    const nse: KiteInstrument[] = [
      {
        instrument_token: "256265",
        tradingsymbol: "NIFTY 50",
        name: "NIFTY 50",
        strike: 0,
        instrument_type: "EQ",
        exchange: "NSE",
        segment: "INDICES",
      },
    ];
    const quote: KiteQuote = {
      timestamp: "2026-10-15 09:59:55",
      last_trade_time: "2026-10-15 09:59:50",
      last_price: 148,
      depth: {
        buy: [{ price: 149, quantity: 75, orders: 1 }],
        sell: [{ price: 151, quantity: 75, orders: 1 }],
      },
    };
    const snapshot = await loadPortfolio(
      {
        getPositions: async () => ({
          net: [position(), position({ tradingsymbol: "INFY", exchange: "NSE", quantity: 10 })],
          day: [position({ tradingsymbol: "NIFTY25OCT24000PE", quantity: -75, instrument_token: 99 })],
        }),
        getInstruments: async (exchange) => (exchange === "NFO" ? nfo : nse),
        getQuote: async () => ({
          "NSE:NIFTY 50": { timestamp: "2026-10-15 09:59:55", last_price: 24050, ohlc: { close: 23927 } },
          "NSE:INDIA VIX": { timestamp: "2026-10-15 09:59:55", last_price: 15.7, ohlc: { close: 14.77 } },
          "NFO:NIFTY25OCT24200CE": quote,
        }),
      },
      { includeFlat: false, now },
    );

    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]?.quote.price).toBe(150);
    expect(snapshot.positions[0]?.quote.price).not.toBe(1);
    expect(snapshot.positions[0]?.brokerLastPrice).toBe(999);
    expect(snapshot.spot.price).toBe(24050);
    expect(snapshot.spot.change).toBe(123);
    expect(snapshot.vix.price).toBe(15.7);
    expect(snapshot.vix.change).toBeCloseTo(0.93);
    expect(snapshot.brokerUnrealised).toBe(80);
    expect(snapshot.brokerDayPnl).toBe(-150);
    expect(snapshot.positions[0]?.brokerDayPnl).toBe(-150);
    expect(snapshot.scenarioInputs[0]?.marketPremium).toBe(150);
  });

  it("keeps a position with a missing quote and does not fabricate a premium", async () => {
    const now = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);
    const snapshot = await loadPortfolio(
      {
        getPositions: async () => ({ net: [position()], day: [] }),
        getInstruments: async () => {
          throw new Error("master down");
        },
        getQuote: async () => ({ "NSE:NIFTY 50": { timestamp: "2026-10-15 09:59:55", last_price: 24000, net_change: -98 } }),
      },
      { includeFlat: false, now },
    );
    expect(snapshot.positions[0]?.quote.quality).toBe("unavailable");
    expect(snapshot.positions[0]?.quote.price).toBeNull();
    expect(snapshot.spot.change).toBe(-98);
    expect(snapshot.warnings.join(" ")).toMatch(/instrument master/i);
  });

  it("keeps a contract closed today in the day's total while hiding it from the open book", async () => {
    const now = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);
    const closed = position({
      tradingsymbol: "NIFTY25OCT24100PE",
      instrument_token: 12,
      quantity: 0,
      overnight_quantity: 75,
      close_price: 110,
      last_price: 130,
      day_buy_value: 0,
      day_sell_quantity: 75,
      day_sell_value: 9000,
      pnl: 750,
      unrealised: 0,
      realised: 750,
    });
    const snapshot = await loadPortfolio(
      {
        getPositions: async () => ({ net: [position(), closed], day: [] }),
        getInstruments: async (exchange) =>
          exchange === "NFO"
            ? [
                {
                  instrument_token: "11",
                  tradingsymbol: "NIFTY25OCT24200CE",
                  name: "NIFTY",
                  expiry: new Date("2026-10-28"),
                  strike: 24200,
                  lot_size: 75,
                  instrument_type: "CE",
                  exchange: "NFO",
                },
                {
                  instrument_token: "12",
                  tradingsymbol: "NIFTY25OCT24100PE",
                  name: "NIFTY",
                  expiry: new Date("2026-10-28"),
                  strike: 24100,
                  lot_size: 75,
                  instrument_type: "PE",
                  exchange: "NFO",
                },
              ]
            : [
                {
                  instrument_token: "256265",
                  tradingsymbol: "NIFTY 50",
                  name: "NIFTY 50",
                  strike: 0,
                  instrument_type: "EQ",
                  exchange: "NSE",
                },
              ],
        getQuote: async () => ({
          "NSE:NIFTY 50": { timestamp: "2026-10-15 09:59:55", last_price: 24050 },
          "NFO:NIFTY25OCT24200CE": { timestamp: "2026-10-15 09:59:55", last_price: 148 },
          "NFO:NIFTY25OCT24100PE": { timestamp: "2026-10-15 09:59:55", last_price: 130 },
        }),
      },
      { includeFlat: false, now },
    );
    expect(snapshot.positions.map((row) => row.tradingSymbol)).toEqual(["NIFTY25OCT24200CE"]);
    expect(snapshot.flatCount).toBe(1);
    expect(snapshot.brokerDayPnl).toBe(-150 + 750);
  });
});
