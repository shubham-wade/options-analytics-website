import { describe, expect, it } from "vitest";
import { bookTotals, buyLot, emptyBook, PaperError, rangeLines, remainingQuantity, sellLot } from "@/lib/paper/lots";

describe("paper lots", () => {
  const opened = { id: "lot-1", symbol: "colpal", quantity: 10, entry: 1600, openedAt: "2026-10-29T10:00:00.000Z", openedOn: "2026-10-29" };

  it("stores a buy and realises the whole lot on a paper sell", () => {
    const bought = buyLot(emptyBook(), opened);
    expect(bought.lots[0]?.symbol).toBe("COLPAL");
    expect(remainingQuantity(bought.lots[0]!) ).toBe(10);
    const sold = sellLot(bought, { id: "lot-1", price: 1629.8, closedAt: "2026-10-29T12:00:00.000Z", closedOn: "2026-10-29" });
    expect(remainingQuantity(sold.lots[0]!)).toBe(0);
    const totals = bookTotals(sold.lots, {});
    expect(totals.realised).toBeCloseTo(298);
    expect(totals.cost).toBe(0);
    expect(totals.unrealised).toBe(0);
  });

  it("marks an open lot to the latest print and refuses a second sell", () => {
    const bought = buyLot(emptyBook(), opened);
    const totals = bookTotals(bought.lots, { "lot-1": 1500 });
    expect(totals.cost).toBe(16000);
    expect(totals.marketValue).toBe(15000);
    expect(totals.unrealised).toBe(-1000);
    const sold = sellLot(bought, { id: "lot-1", price: 1500, closedAt: "2026-10-29T12:00:00.000Z", closedOn: "2026-10-29" });
    expect(() => sellLot(sold, { id: "lot-1", price: 1500, closedAt: "2026-10-29T13:00:00.000Z", closedOn: "2026-10-29" })).toThrow(PaperError);
  });

  it("describes a price near the high, one well above the low, and one still near the low", () => {
    expect(
      rangeLines({ last: 50, yearLow: 20, yearHigh: 52, firstPrice: 40, firstDate: "2026-10-01" }),
    ).toEqual([
      "Last is +150.00% from the 52-week low and −3.85% from the 52-week high.",
      "Last is close to the 52-week high.",
      "Since the first saved reading on 1 Oct 2026, the price is +25.00%.",
    ]);
    expect(rangeLines({ last: 40, yearLow: 20, yearHigh: 80, firstPrice: null, firstDate: null })).toEqual([
      "Last is +100.00% from the 52-week low and −50.00% from the 52-week high.",
      "Last is already well above the 52-week low.",
    ]);
    expect(rangeLines({ last: 1629.8, yearLow: 1576.8, yearHigh: 2301.6, firstPrice: 1629.8, firstDate: "2026-10-29" })).toEqual([
      "Last is +3.36% from the 52-week low and −29.19% from the 52-week high.",
      "The price is unchanged since the first saved reading on 29 Oct 2026.",
    ]);
  });
});
