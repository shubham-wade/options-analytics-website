import { describe, expect, it } from "vitest";
import { narrateReport, type Narration } from "@/lib/report/narrate";
import type { IndexPrint } from "@/lib/report/types";

function nifty(overrides: Partial<IndexPrint> = {}): IndexPrint {
  return {
    name: "NIFTY 50",
    open: 23016,
    high: 23120.9,
    low: 22649.9,
    close: 22811.35,
    previousClose: 22888.95,
    change: -77.6,
    percentChange: -0.34,
    advances: 16,
    declines: 34,
    unchanged: 0,
    closingLocation: 0.34,
    gap: 127,
    ...overrides,
  };
}

function session(overrides: Partial<Narration> = {}): Narration {
  return {
    nifty: nifty(),
    bankNifty: nifty({ name: "NIFTY BANK", change: -511.2, percentChange: -0.92, close: 54976.9, gap: 220, closingLocation: 0.24 }),
    vix: { close: 15.7, previousClose: 14.77, change: 0.93, percentChange: 6.29, regime: "moderate", regimeRule: "" },
    sectors: [
      { name: "NIFTY IT", percentChange: 2.88 },
      { name: "NIFTY FINANCIAL SERVICES", percentChange: -1.18 },
      { name: "NIFTY METAL", percentChange: -1.71 },
    ],
    contributors: {
      points: -77,
      pullers: [
        { symbol: "INFY", weight: 3, percentChange: 3, points: 28 },
        { symbol: "TCS", weight: 2, percentChange: 2, points: 15 },
        { symbol: "BHARTIARTL", weight: 5, percentChange: 1, points: 10 },
      ],
      draggers: [
        { symbol: "BAJFINANCE", weight: 2, percentChange: -3, points: -18 },
        { symbol: "HDFCBANK", weight: 10, percentChange: -1, points: -16 },
        { symbol: "AXISBANK", weight: 3, percentChange: -2, points: -16 },
      ],
    },
    cash: { today: { fii: 1022.32, dii: 1614.32 } },
    participants: [
      { name: "Client", futureIndexLongChange: -4819, futureIndexShortChange: 2041, longRatio: 0.84 },
      { name: "Pro", futureIndexLongChange: 1273, futureIndexShortChange: -2168, longRatio: 0.6 },
      { name: "FII", futureIndexLongChange: -4063, futureIndexShortChange: -6365, longRatio: 0.095 },
    ],
    futures: { priceChange: -77.6, oi: 406064, oiChange: -7686, reading: "Possible long unwinding: the index fell while index-futures open interest fell." },
    chains: [{ expiry: "27-Oct-2026", pcr: 0.7, topCalls: [{ strike: 23000 }], topPuts: [{ strike: 22000 }] }],
    ...overrides,
  };
}

describe("plain-language report", () => {
  it("tells a down day in ordinary words without treating cash buying as a forecast", () => {
    const text = narrateReport(session()).join(" ");
    expect(text).toMatch(/NIFTY finished at 22,811.35, down 77.6 points/);
    expect(text).toMatch(/opened 127 points above the previous close/);
    expect(text).toMatch(/16 stocks rose and 34 fell/);
    expect(text).toMatch(/IT rose 2.88%/);
    expect(text).toMatch(/INFY, TCS and BHARTIARTL added the most points/);
    expect(text).toMatch(/BAJFINANCE, HDFCBANK and AXISBANK took the most points out/);
    expect(text).toMatch(/foreign institutions bought ₹1,022.32 crore/);
    expect(text).toMatch(/domestic institutions bought ₹1,614.32 crore/);
    expect(text).toMatch(/index still closed lower/);
    expect(text).toMatch(/clients cut 4,819 long contracts and added 2,041 short contracts/);
    expect(text).toMatch(/usually read as longs being closed/);
    expect(text).toMatch(/busiest call strike is 23,000/);
    expect(text).toMatch(/free-float weight/);
    expect(text).toMatch(/INFY accounted for 28 points/);
    expect(text).toMatch(/decline was broad inside the fifty/);
    expect(text).toMatch(/net cash bought minus cash sold/);
    expect(text).toMatch(/calls carry the larger pile/);
    expect(text).toMatch(/not a prediction of the next session/);
    expect(text).toMatch(/not a prediction of the next one/);
    expect(text).not.toMatch(/clients (bought|sold)/i);
    expect(text).not.toMatch(/Possible long unwinding/);
  });

  it("says when the evening cash file is still missing", () => {
    const text = narrateReport(session({ cash: { today: null } }), { cashPending: true }).join(" ");
    expect(text).toMatch(/between 5:30 and 6:30/);
  });

  it("says the index rose when the close is higher", () => {
    const text = narrateReport(session({ nifty: nifty({ change: 148, percentChange: 0.65, closingLocation: 0.8, gap: -30 }), cash: { today: { fii: -10, dii: -20 } } })).join(" ");
    expect(text).toMatch(/up 148 points/);
    expect(text).toMatch(/opened 30 points below the previous close and recovered/);
    expect(text).toMatch(/Both were sellers, and the index still closed higher/);
    expect(text).toMatch(/rise was carried by the heavier names/);
  });
});
