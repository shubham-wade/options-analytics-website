import { describe, expect, it } from "vitest";
import { NSE_HOLIDAYS, SEEDED_DAILY_PNL, buildDailySeries, progressSummary, signedProgressSeries } from "@/lib/pnl/daily";

describe("daily P&L season", () => {
  const series = buildDailySeries(SEEDED_DAILY_PNL);

  it("starts on 1 Oct, ends on 31 Mar, and keeps only weekdays", () => {
    expect(series[0]?.date).toBe("2026-10-01");
    expect(series.at(-1)?.date).toBe("2027-03-31");
    expect(series.some((point) => point.date === "2026-10-03" || point.date === "2026-10-04")).toBe(false);
  });

  it("drops published NSE holidays, including Gandhi Jayanti", () => {
    expect(series.some((point) => point.date === "2026-10-02")).toBe(false);
    expect(NSE_HOLIDAYS["2026-10-02"]).toMatch(/Gandhi/);
    expect(series.some((point) => point.date === "2026-10-20" || point.date === "2026-12-25")).toBe(false);
    expect(series.some((point) => point.date === "2027-01-26")).toBe(false);
  });

  it("plots the file entries and leaves later weekdays open through 31 Mar", () => {
    expect(series.at(-1)?.date).toBe("2027-03-31");
    expect(series.find((point) => point.date === "2026-10-01")?.pnl).toBe(-20.95);
    expect(series.find((point) => point.date === "2026-10-08")?.pnl).toBe(-20.95);
    expect(series.find((point) => point.date === "2026-10-14")?.pnl).toBe(-19.95);
    expect(series.find((point) => point.date === "2026-10-15")?.pnl).toBe(-19.85);
    expect(series.find((point) => point.date === "2026-10-16")?.pnl).toBe(-19.5);
    expect(series.find((point) => point.date === "2026-10-19")?.pnl).toBe(-20);
    expect(series.find((point) => point.date === "2026-10-21")?.pnl).toBe(-20.65);
    expect(series.find((point) => point.date === "2026-10-22")?.pnl).toBe(-20.85);
    expect(series.find((point) => point.date === "2026-10-23")?.pnl).toBe(-21.65);
    expect(series.find((point) => point.date === "2026-10-26")?.pnl).toBe(-20.7);
    expect(series.find((point) => point.date === "2026-10-27")?.pnl).toBe(-20.75);
    expect(series.find((point) => point.date === "2026-10-28")?.pnl).toBe(-20.5);
    expect(series.find((point) => point.date === "2026-10-29")?.pnl).toBe(-19.65);
    const progress = progressSummary(series);
    expect(progress.latest).toBe(-19.65);
    expect(progress.asOf).toBe("2026-10-29");
    expect(progress.change).toBeCloseTo(1.3);
    expect(progress.count).toBe(19);
  });

  it("keeps losses on the red series and gains on the green series", () => {
    const signed = signedProgressSeries(series);
    const october8 = signed.find((point) => point.date === "2026-10-08" && !point.crossing);
    expect(october8?.loss).toBe(-20.95);
    expect(october8?.gain).toBeNull();
    const crossed = signedProgressSeries([
      { date: "2026-10-19", pnl: -2 },
      { date: "2026-10-21", pnl: 4 },
    ]);
    expect(crossed.filter((point) => point.crossing)).toEqual([
      { x: 1 / 3, date: "2026-10-19", pnl: 0, loss: 0, gain: 0, crossing: true },
    ]);
    const gapped = signedProgressSeries([
      { date: "2026-10-19", pnl: -2 },
      { date: "2026-10-20", pnl: null },
      { date: "2026-10-21", pnl: 4 },
    ]);
    expect(gapped.some((point) => point.crossing)).toBe(false);
  });
});
