import { describe, expect, it } from "vitest";
import { averageFromMinuteBars, compareSnapshots, holdingMoves, holdingSpan, parseFundamentals, parseHolding, parseHoldings, parseLivePrice, parseStatements, publishedStatements } from "@/lib/stocks/parse";
import type { StockSnapshot } from "@/lib/stocks/types";

const company = {
  fundamentals: [
    { name: "Market Cap", value: "₹50,905Cr" },
    { name: "P/E Ratio(TTM)", value: "16.16" },
    { name: "ROE", value: "33.43%" },
    { name: "Debt to Equity", value: "0.06" },
  ],
  shareHoldingPattern: {
    "Jun '26": {
      promoters: { individual: { percent: 11.7 } },
      foreignInstitutions: { percent: 26 },
      mutualFunds: { percent: 6.4 },
    },
    "Sep '26": {
      promoters: { individual: { percent: 11.7 }, government: { percent: 0 } },
      mutualFunds: { percent: 6.54 },
      otherDomesticInstitutions: { insurance: { percent: 3.71 } },
      foreignInstitutions: { percent: 25.48 },
      retailAndOthers: { percent: 52.57 },
    },
  },
  financialStatementV2: {
    CONSOLIDATED: [
      { title: "Revenue", yearly: { 2025: 100, 2026: 120 }, quarterly: { "Jun '26": 30 } },
      { title: "Profit", yearly: { 2025: 10, 2026: 12 }, quarterly: { "Jun '26": 4 } },
      { title: "Net Worth", yearly: { 2026: 80 } },
    ],
  },
};

function snapshot(price: number, pe: number): StockSnapshot {
  return {
    date: "2026-10-28",
    savedAt: "2026-10-28T10:00:00.000Z",
    price: {
      last: price,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      previousClose: null,
      volume: null,
      average: null,
      averageSource: null,
      yearHigh: null,
      yearLow: null,
      source: "groww",
    },
    fundamentals: {
      marketCapCrore: null,
      pe,
      industryPe: null,
      eps: null,
      pb: null,
      roe: 33.43,
      debtToEquity: 0.06,
      bookValue: null,
      dividendYield: null,
      faceValue: null,
    },
    holding: null,
    holdings: [],
    years: [],
    quarters: [],
  };
}

describe("stock files", () => {
  it("reads published valuation, the newest shareholding quarter, and results", () => {
    expect(parseFundamentals(company.fundamentals)).toMatchObject({
      marketCapCrore: 50905,
      pe: 16.16,
      roe: 33.43,
      debtToEquity: 0.06,
    });
    expect(parseHolding(company.shareHoldingPattern)).toMatchObject({
      quarter: "Sep '26",
      promoter: 11.7,
      foreignInstitutions: 25.48,
      insurance: 3.71,
    });
    expect(parseHoldings(company.shareHoldingPattern).map((row) => row.quarter)).toEqual(["Jun '26", "Sep '26"]);
    const moves = holdingMoves(parseHoldings(company.shareHoldingPattern));
    expect(moves.find((move) => move.label === "Foreign institutions")?.text).toContain("fell");
    expect(moves.find((move) => move.label === "Mutual funds")?.direction).toBe("up");
    const span = holdingSpan([
      { quarter: "Sep '25", promoter: 11.73, mutualFunds: 4.91, insurance: 5.25, foreignInstitutions: 24.57, retailAndOthers: 53.54 },
      { quarter: "Jun '26", promoter: 11.71, mutualFunds: 6.47, insurance: 4.64, foreignInstitutions: 26.01, retailAndOthers: 51.18 },
      { quarter: "Sep '26", promoter: 11.7, mutualFunds: 6.54, insurance: 3.71, foreignInstitutions: 25.48, retailAndOthers: 52.57 },
    ]);
    expect(span.find((move) => move.label === "Foreign institutions")?.text).toContain("peaked at 26.01% in Jun '26");
    expect(span.find((move) => move.label === "Mutual funds")?.text).toContain("Sep '25");
    const statements = parseStatements(company.financialStatementV2.CONSOLIDATED);
    expect(statements.years.at(-1)).toEqual({ year: "2026", revenue: 120, profit: 12, netWorth: 80 });
    expect(statements.quarters).toEqual([{ quarter: "Jun '26", revenue: 30, profit: 4 }]);
  });

  it("uses standalone results when the consolidated series is empty", () => {
    const listedOnly = {
      financialStatementV2: {
        CONSOLIDATED: [
          { title: "Revenue", yearly: {} },
          { title: "Profit", yearly: {} },
          { title: "Net Worth", yearly: {} },
        ],
        STANDALONE: [
          { title: "Revenue", yearly: { 2026: 6400 }, quarterly: { "Sep '26": 1728 } },
          { title: "Profit", yearly: { 2026: 1300 }, quarterly: { "Sep '26": 342 } },
          { title: "Net Worth", yearly: { 2026: 1600 } },
        ],
      },
    };
    const published = publishedStatements(listedOnly);
    expect(published.accounts).toBe("standalone");
    expect(parseStatements(published.statements).quarters).toEqual([{ quarter: "Sep '26", revenue: 1728, profit: 342 }]);
    expect(publishedStatements(company).accounts).toBe("consolidated");
  });

  it("keeps the live print and the previous close", () => {
    const price = parseLivePrice({ ltp: 36.52, dayChange: -0.78, dayChangePerc: -2.09, volume: 1000 }, 61.5, 36.31);
    expect(price.last).toBe(36.52);
    expect(price.previousClose).toBeCloseTo(37.3);
    expect(price.yearHigh).toBe(61.5);
    expect(price.average).toBeNull();
  });

  it("weights the day average by minute-bar volume", () => {
    const average = averageFromMinuteBars({
      chart: {
        result: [
          {
            indicators: {
              quote: [{ high: [10, 12], low: [8, 10], close: [9, 11], volume: [100, 300] }],
            },
          },
        ],
      },
    });
    expect(average).toBe(10.5);
  });

  it("describes what moved between two saved readings", () => {
    const changes = compareSnapshots(snapshot(40, 18), { ...snapshot(36.5, 16.16), date: "2026-10-29" });
    expect(changes.map((change) => change.label)).toEqual(["Price", "P/E"]);
    expect(changes[0]?.direction).toBe("down");
    expect(changes[1]?.text).toContain("lower");
  });
});
