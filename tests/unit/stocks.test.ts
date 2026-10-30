import { describe, expect, it } from "vitest";
import { removeStock } from "@/lib/stocks/book";
import { averageFromMinuteBars, compareSnapshots, highlightFrameClass, holdingMoves, holdingSpan, nextHighlight, parseComment, parseCompanyExtras, parseFundamentals, parseGrowwPage, parseHighlight, parseHolding, parseHoldings, parseLivePrice, parseStatements, peStats, percentFromHigh, publishedStatements, screenerUrl, sortByHighlight, STOCK_COMMENT_MAX, toStockSummary } from "@/lib/stocks/parse";
import { peValues, quarterlyEps, summarisePe, tickerTapeSid, trailingEps, weeklyCloses } from "@/lib/stocks/pe";
import { stockNotes } from "@/lib/stocks/reading";
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
  it("builds the Screener page from the NSE symbol", () => {
    expect(screenerUrl("campus")).toBe("https://www.screener.in/company/CAMPUS/");
  });

  it("does not remove a stock that was never saved", async () => {
    expect(await removeStock("ZZZNOPE")).toBe(false);
  });

  it("keeps a green-to-red highlight and rejects other colours", () => {
    expect(parseHighlight(null)).toBeNull();
    expect(parseHighlight("green")).toBe("green");
    expect(parseHighlight("red")).toBe("red");
    expect(highlightFrameClass("green")).toContain("emerald");
    expect(highlightFrameClass("green")).toContain("nrl-highlight-frame");
    expect(nextHighlight(null)).toBe("green");
    expect(nextHighlight("green")).toBe("lime");
    expect(nextHighlight("red")).toBe("green");
    expect(
      sortByHighlight([
        { symbol: "ZZZ", highlight: null },
        { symbol: "RED", highlight: "red" },
        { symbol: "ACE", highlight: "green" },
        { symbol: "BEE", highlight: "green" },
      ]).map((row) => row.symbol),
    ).toEqual(["ACE", "BEE", "RED", "ZZZ"]);
    expect(
      toStockSummary({
        symbol: "ACE",
        name: "Action Construction Equipment",
        isin: null,
        industry: "Engineering",
        exchange: "NSE",
        searchId: "ace",
        snapshots: [snapshot(1027, 16)],
        highlight: "green",
      }),
    ).toMatchObject({ symbol: "ACE", price: 1027, readings: 1, highlight: "green", pe: 16, peHigh: 16, peMedian: 16 });
    expect(percentFromHigh(191.26, 286.55)).toBeCloseTo(-33.25, 2);
    expect(peStats([snapshot(10, 20), snapshot(11, 40), snapshot(12, 30)])).toMatchObject({ pe: 30, peHigh: 40, peMedian: 30 });
    expect(
      toStockSummary({
        symbol: "ACE",
        name: "Action Construction Equipment",
        isin: null,
        industry: "Engineering",
        exchange: "NSE",
        searchId: "ace",
        snapshots: [snapshot(1027, 16)],
        pe: { median: 22.5, high: 80, samples: 40, asOf: "2026-10-30" },
      }),
    ).toMatchObject({ pe: 16, peMedian: 22.5, peHigh: 80 });
    expect(
      toStockSummary({
        symbol: "ACE",
        name: "Action Construction Equipment",
        isin: null,
        industry: "Engineering",
        exchange: "NSE",
        searchId: "ace",
        snapshots: [snapshot(360, 44)],
        pe: { median: 14.69, high: 30.45, samples: 40, asOf: "2026-10-30" },
      }),
    ).toMatchObject({ pe: 44, peMedian: 14.69, peHigh: 44 });
    expect(() => parseHighlight("blue")).toThrow(/Highlight/);
    expect(parseComment(null)).toBe("");
    expect(parseComment("watch the next print")).toBe("watch the next print");
    expect(() => parseComment("x".repeat(STOCK_COMMENT_MAX + 1))).toThrow(/too long/);
  });

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

  it("uses standalone results when that series is newer than consolidated", () => {
    const listedOnly = {
      financialStatementV2: {
        CONSOLIDATED: [
          { title: "Revenue", yearly: { 2022: 1196 } },
          { title: "Profit", yearly: { 2022: 107 } },
          { title: "Net Worth", yearly: { 2022: 427 } },
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

  it("reads the company description, growth, peers, headlines, and dividends", () => {
    const extras = parseCompanyExtras({
      details: { foundedYear: 1937, businessSummary: "  Oral care.  " },
      financialStatement: [
        { title: "Revenue", cagr: { oneYearTtm: 0.13, threeYearCagr: 0.05 } },
        { title: "Profit", cagr: { oneYearTtm: 0.04, threeYearCagr: 0.08 } },
      ],
      similarAssets: {
        peerList: [
          { companyHeader: { nseScriptCode: "EMAMILTD", displayName: "Emami" }, marketCap: 16272, peRatio: 21.7, pbRatio: 5.57 },
          { companyHeader: { nseScriptCode: "CUPID", displayName: "Cupid" }, marketCap: 42276, peRatio: 308.24, pbRatio: 93.78 },
        ],
      },
    });
    expect(extras.profile).toEqual({ foundedYear: 1937, businessSummary: "Oral care." });
    expect(extras.growth).toEqual({ revenueOneYear: 13, revenueThreeYear: 5, profitOneYear: 4, profitThreeYear: 8 });
    expect(extras.peers.map((peer) => peer.symbol)).toEqual(["EMAMILTD", "CUPID"]);
    const page = parseGrowwPage({
      props: {
        pageProps: {
          newsData: [{ pubDate: "2026-10-23T10:40:00", source: "Zee Business", title: "Shares hit a 52-week low.", url: "https://example.com/story" }],
          eventsData: [
            {
              corporateEventFilter: "DIVIDEND",
              eventType: "Ex date",
              eventMetadata: { dividendAmount: "24.0", dividendDate: "2026-11-02", dividendType: "Interim 1" },
            },
            { corporateEventFilter: "RESULTS", eventTitle: "Quarterly Result", primaryDate: "2026-10-22T00:00:00" },
          ],
        },
      },
    });
    expect(page.news[0]).toMatchObject({ source: "Zee Business", url: "https://example.com/story" });
    expect(page.dividends).toEqual([{ exDate: "2026-11-02", amount: 24, kind: "Interim 1" }]);
    expect(page.results).toEqual([{ date: "2026-10-22", title: "Quarterly Result" }]);
    const notes = stockNotes({
      price: { last: 1629.8, yearLow: 1576.8, yearHigh: 2301.6 },
      fundamentals: { pe: 32, industryPe: 34.8, dividendYield: 3.62, debtToEquity: 0.03, roe: 84.19 },
      years: [
        { year: "2025", revenue: 6179.01, profit: 1436.81, netWorth: 1664 },
        { year: "2026", revenue: 6124.16, profit: 1325.31, netWorth: 1584 },
      ],
      quarters: [
        { quarter: "Sep '25", revenue: 1534.53, profit: 327.51 },
        { quarter: "Sep '26", revenue: 1727.5, profit: 341.57 },
      ],
      growth: extras.growth,
      holdings: [
        { quarter: "Sep '25", promoter: 51, mutualFunds: 5.46, insurance: 6.77, foreignInstitutions: 17.16, retailAndOthers: 19.6 },
        { quarter: "Sep '26", promoter: 51, mutualFunds: 7.38, insurance: 8.07, foreignInstitutions: 13.71, retailAndOthers: 19.83 },
      ],
      peers: extras.peers,
      dividends: page.dividends,
      results: page.results,
      news: page.news,
      asOf: "2026-10-29",
    });
    const byHeading = Object.fromEntries(notes.map((note) => [note.heading, note.text]));
    expect(byHeading.Price).toBe("Last is +3.36% from the 52-week low and −29.19% from the 52-week high.");
    expect(byHeading.Results).toContain("net margin of 19.8%");
    expect(byHeading.Results).toContain("21.3%");
    expect(byHeading.Growth).toContain("Trailing one-year revenue growth is 13.00%");
    expect(byHeading.Peers).toContain("21.70 (Emami)");
    expect(byHeading.Peers).toContain("308.24 (Cupid)");
    expect(byHeading.Dividend).toContain("2 Nov 2026");
    expect(byHeading.Calendar).toContain("Zee Business");
    expect(notes.some((note) => /buy|sell/i.test(note.text))).toBe(false);
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

  it("builds listed-history P/E from quarterly EPS and weekly closes", () => {
    expect(
      tickerTapeSid(
        {
          data: {
            searchResults: [
              { sid: "SUN", stock: { info: { ticker: "SUNPHARMA" } } },
              { sid: "CAMP", stock: { info: { ticker: "CAMPUS" } } },
            ],
          },
        },
        "CAMPUS",
      ),
    ).toBe("CAMP");
    expect(tickerTapeSid({ data: { searchResults: [{ sid: "SUN", stock: { info: { ticker: "SUNPHARMA" } } }] } }, "ACE")).toBeNull();
    const quarters = quarterlyEps({
      data: [
        { endDate: "2021-03-31T00:00:00.000Z", qIncEps: 1 },
        { endDate: "2021-06-30T00:00:00.000Z", qIncEps: 1 },
        { endDate: "2021-09-30T00:00:00.000Z", qIncEps: 1 },
        { endDate: "2021-12-31T00:00:00.000Z", qIncEps: 1 },
        { endDate: "2022-03-31T00:00:00.000Z", qIncEps: 2 },
      ],
    });
    expect(trailingEps(quarters)).toEqual([
      { date: "2021-12-31", eps: 4 },
      { date: "2022-03-31", eps: 5 },
    ]);
    const closes = weeklyCloses({
      chart: {
        result: [
          {
            timestamp: [1640908800, 1648771200],
            indicators: { quote: [{ close: [80, 100] }] },
          },
        ],
      },
    });
    expect(closes.map((row) => row.close)).toEqual([80, 100]);
    expect(summarisePe(peValues(closes, trailingEps(quarters)))).toMatchObject({
      median: 20,
      high: 20,
      samples: 2,
    });
  });
});
