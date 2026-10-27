import { describe, expect, it } from "vitest";
import { marketBriefFrom } from "@/lib/report/brief";

describe("dashboard market brief", () => {
  it("keeps three movers and the client, pro, and FII futures changes", () => {
    const brief = marketBriefFrom({
      asOf: "2026-10-21",
      contributors: {
        pullers: [
          { symbol: "INFY", weight: 3, percentChange: 3, points: 28 },
          { symbol: "TCS", weight: 2, percentChange: 2, points: 15 },
          { symbol: "BHARTIARTL", weight: 2, percentChange: 1, points: 10 },
          { symbol: "RELIANCE", weight: 8, percentChange: 0.4, points: 9 },
        ],
        draggers: [
          { symbol: "BAJFINANCE", weight: 2, percentChange: -3, points: -18 },
          { symbol: "HDFCBANK", weight: 10, percentChange: -1, points: -16 },
          { symbol: "AXISBANK", weight: 3, percentChange: -2, points: -16 },
          { symbol: "SBIN", weight: 2, percentChange: -1, points: -9 },
        ],
      },
      participants: [
        { name: "Client", futureIndexLongChange: -4819, futureIndexShortChange: 2041 },
        { name: "Pro", futureIndexLongChange: 1273, futureIndexShortChange: -2168 },
        { name: "FII", futureIndexLongChange: -4063, futureIndexShortChange: -6365 },
        { name: "DII", futureIndexLongChange: 100, futureIndexShortChange: 50 },
      ],
      futures: { reading: "Possible long unwinding." },
      chains: [{ expiry: "27-Oct-2026", topCalls: [{ strike: 23000 }], topPuts: [{ strike: 22600 }] }],
    });
    expect(brief.pullers.map((row) => row.symbol)).toEqual(["INFY", "TCS", "BHARTIARTL"]);
    expect(brief.draggers.map((row) => row.symbol)).toEqual(["BAJFINANCE", "HDFCBANK", "AXISBANK"]);
    expect(brief.books.map((row) => row.name)).toEqual(["Client", "Pro", "FII"]);
    expect(brief.books[0]?.longChange).toBe(-4819);
    expect(brief.oi).toEqual({ expiry: "27-Oct-2026", callStrike: 23000, putStrike: 22600 });
    expect(brief.futuresReading).toBe("Possible long unwinding.");
  });
});
