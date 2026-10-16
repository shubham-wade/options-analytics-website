import { describe, expect, it } from "vitest";
import {
  atIst,
  buildFlowSeries,
  expectedPublishedDate,
  flowFrame,
  mergeFlowFetch,
  parseNseFiiDii,
  type FlowBook,
} from "@/lib/flows/fii-dii";

const book: FlowBook = {
  updatedAt: null,
  lastAttemptAt: null,
  missed: [],
  entries: {
    "2026-10-16": { fii: 1165.92, dii: -3661.28 },
  },
};

describe("FII/DII cash flows", () => {
  const series = buildFlowSeries({
    "2026-07-01": { fii: -1140.5, dii: 3159.2 },
    "2026-10-01": { fii: -9484.22, dii: 10041.84 },
    "2026-10-16": { fii: 1165.92, dii: -3661.28 },
  });

  it("uses weekday sessions from July through March and drops holidays", () => {
    expect(series[0]?.date).toBe("2026-07-01");
    expect(series.at(-1)?.date).toBe("2027-03-31");
    expect(series.some((point) => point.date === "2026-07-04" || point.date === "2026-09-14" || point.date === "2026-10-02")).toBe(false);
    expect(series.find((point) => point.date === "2026-10-16")).toMatchObject({ fii: 1165.92, dii: -3661.28 });
    expect(series.find((point) => point.date === "2026-09-01")?.fii).toBeNull();
    const framed = flowFrame(series);
    expect(series[framed.start]?.date >= "2026-07-19").toBe(true);
    expect(series[framed.start + framed.count - 1]?.date).toBe("2026-10-16");
  });

  it("reads the combined NSE payload", () => {
    expect(
      parseNseFiiDii([
        { buyValue: "17201.8", category: "DII", date: "16-Oct-2026", netValue: "-3661.28", sellValue: "20863.08" },
        { buyValue: "19951.59", category: "FII/FPI", date: "16-Oct-2026", netValue: "1165.92", sellValue: "18785.67" },
      ]),
    ).toEqual({ date: "2026-10-16", fii: 1165.92, dii: -3661.28 });
  });

  it("treats the latest session as published only after 16:00 IST", () => {
    expect(expectedPublishedDate(atIst(2026, 10, 16, 18, 0))).toBe("2026-10-16");
    expect(expectedPublishedDate(atIst(2026, 10, 16, 10, 0))).toBe("2026-10-15");
    expect(expectedPublishedDate(atIst(2026, 10, 17, 11, 0))).toBe("2026-10-16");
  });

  it("keeps a later session and records the trading days the feed skipped", () => {
    const saved = mergeFlowFetch(book, { date: "2026-10-21", fii: 10, dii: -4 }, atIst(2026, 10, 21, 18, 0));
    expect(saved.book.entries["2026-10-21"]).toEqual({ fii: 10, dii: -4 });
    expect(saved.book.missed).toEqual(["2026-10-19"]);
    expect(saved.notices.some((notice) => notice.detail.includes("19 Oct"))).toBe(true);
  });

  it("reports a failed fetch without inventing a session", () => {
    const saved = mergeFlowFetch(book, null, atIst(2026, 10, 19, 18, 0));
    expect(saved.book.entries["2026-10-19"]).toBeUndefined();
    expect(saved.notices[0]?.title).toBe("FII/DII not fetched");
  });
});
