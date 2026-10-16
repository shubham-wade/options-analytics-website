import { describe, expect, it } from "vitest";
import { buildFuturesRead, closingLocation, futuresReading, indexContributors, longRatio, parseIndexClose, parseParticipantOi, summarizeCash, summarizeChain, vixRegime } from "@/lib/report/parse";
import { liveCaptureAllowed, pendingReportDates, reportReady, reportSessions, resolveReportDate } from "@/lib/report/sessions";
import { atIst } from "@/lib/flows/fii-dii";

const csv = `"Participant wise Open Interest as on Oct 16, 2026",
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short
FII,40,160,1,1,10,30,5,5
DII,10,10,1,1,1,1,1,1
Pro,5,5,1,1,1,1,1,1
Client,20,20,1,1,1,1,1,1
TOTAL,75,75,4,4,13,33,8,8
`;

describe("post-market report figures", () => {
  it("splits the index move across free-float weights", () => {
    const contribution = indexContributors({
      data: [
        { symbol: "NIFTY 50", previousClose: 1000, lastPrice: 990 },
        { symbol: "AAA", lastPrice: 110, previousClose: 100, ffmc: 1100 },
        { symbol: "BBB", lastPrice: 105, previousClose: 100, ffmc: 525 },
        { symbol: "CCC", lastPrice: 90, previousClose: 100, ffmc: 450 },
        { symbol: "DDD", lastPrice: 80, previousClose: 100, ffmc: 400 },
      ],
    }, 2);
    expect(contribution?.points).toBeCloseTo(-10);
    expect(contribution?.pullers.map((row) => row.symbol)).toEqual(["AAA", "BBB"]);
    expect(contribution?.pullers[0]?.points).toBeCloseTo(40);
    expect(contribution?.pullers[0]?.weight).toBeCloseTo(40);
    expect(contribution?.draggers.map((row) => [row.symbol, row.points])).toEqual([["DDD", -40], ["CCC", -20]]);
  });

  it("captures the close after 16:00 and catches sessions missed while offline", () => {
    expect(liveCaptureAllowed(atIst(2026, 10, 16, 18), "2026-10-16")).toBe(true);
    expect(liveCaptureAllowed(atIst(2026, 10, 16, 10), "2026-10-15")).toBe(false);
    expect(liveCaptureAllowed(atIst(2026, 10, 17, 11), "2026-10-16")).toBe(true);
    expect(liveCaptureAllowed(atIst(2026, 10, 19, 8), "2026-10-16")).toBe(true);
    expect(liveCaptureAllowed(atIst(2026, 10, 19, 10), "2026-10-16")).toBe(false);
    expect(liveCaptureAllowed(atIst(2026, 10, 19, 16, 15), "2026-10-19")).toBe(true);
    expect(pendingReportDates(["2026-10-16", "2026-10-17"], "2026-10-21")).toEqual(["2026-10-19", "2026-10-21"]);
    expect(pendingReportDates([], "2026-10-16")).toEqual(["2026-10-16"]);
    const ready = { nifty: {}, participants: [{}], contributors: {}, chains: [{}], cash: { today: {} }, volatility: { daily: 0.01 } };
    expect(reportReady(ready, "live")).toBe(true);
    expect(reportReady({ ...ready, contributors: null, chains: [], volatility: null }, "archive")).toBe(true);
    expect(reportReady({ ...ready, cash: { today: null } }, "live")).toBe(false);
  });

  it("opens the latest session and lists earlier trading days", () => {
    const sessions = reportSessions("2026-10-16");
    expect(sessions[0]).toBe("2026-10-16");
    expect(sessions[1]).toBe("2026-10-15");
    expect(sessions).not.toContain("2026-10-17");
    expect(sessions).not.toContain("2026-10-11");
    expect(sessions).not.toContain("2026-10-02");
    expect(sessions.at(-1)).toBe("2026-07-01");
    expect(resolveReportDate(null, "2026-10-16")).toBe("2026-10-16");
    expect(resolveReportDate("2026-10-17", "2026-10-16")).toBe("2026-10-16");
    expect(resolveReportDate("2026-10-15", "2026-10-16")).toBe("2026-10-15");
  });

  it("reads an archived index close", () => {
    const rows = parseIndexClose("Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%)\nNifty 50,15-10-2026,22671.3,23056.4,22637.4,22997.35,374.65,1.66\nIndia VIX,15-10-2026,14.625,14.9475,13.9075,14.03,-0.6,-4.1\n");
    expect(rows.get("NIFTY 50")?.last).toBeCloseTo(22997.35);
    expect(rows.get("NIFTY 50")?.previousClose).toBeCloseTo(22622.7);
    expect(rows.get("INDIA VIX")?.percentChange).toBeCloseTo(-4.1);
  });

  it("places the close inside the day's range", () => {
    expect(closingLocation(110, 100, 120)).toBeCloseTo(0.5);
    expect(closingLocation(100, 100, 100)).toBeNull();
  });

  it("labels India VIX with the stated bands", () => {
    expect(vixRegime(12.9)).toBe("low");
    expect(vixRegime(14)).toBe("moderate");
    expect(vixRegime(18)).toBe("elevated");
  });

  it("reads participant contracts and the long ratio", () => {
    const parsed = parseParticipantOi(csv);
    expect(parsed.rows.FII?.futureIndexLong).toBe(40);
    expect(parsed.rows.FII?.futureIndexShort).toBe(160);
    expect(parsed.indexFutureOi).toBe(75);
    expect(longRatio(40, 160)).toBeCloseTo(0.2);
  });

  it("reads a price rise with rising open interest as possible long buildup", () => {
    expect(futuresReading(10, 5)).toMatch(/long buildup/);
    expect(buildFuturesRead(10, 80, 75)?.oiChange).toBe(5);
  });

  it("sums put and call open interest for the put-call ratio", () => {
    const chain = summarizeChain("19-Oct-2026", {
      records: {
        data: [
          { strikePrice: 100, CE: { openInterest: 10, changeinOpenInterest: 1, impliedVolatility: 12 }, PE: { openInterest: 20, changeinOpenInterest: -1, impliedVolatility: 18 } },
          { strikePrice: 110, CE: { openInterest: 30, changeinOpenInterest: 2, impliedVolatility: 11 }, PE: { openInterest: 10, changeinOpenInterest: 0, impliedVolatility: 0 } },
        ],
      },
    }, 100);
    expect(chain?.pcr).toBeCloseTo(0.75);
    expect(chain?.atmStrike).toBe(100);
    expect(chain?.atmIv).toBeCloseTo(15);
    expect(chain?.topCalls[0]?.strike).toBe(110);
  });

  it("sums saved cash sessions for the day, the last five, and the month", () => {
    const cash = summarizeCash("2026-10-16", {
      "2026-10-14": { fii: -10, dii: 4 },
      "2026-10-15": { fii: -5, dii: 3 },
      "2026-10-16": { fii: 2, dii: -1 },
      "2026-10-17": { fii: 99, dii: 99 },
    });
    expect(cash.today).toMatchObject({ fii: 2, dii: -1, combined: 1 });
    expect(cash.fiveDay?.sessions).toBe(3);
    expect(cash.month?.fii).toBe(-13);
  });
});
