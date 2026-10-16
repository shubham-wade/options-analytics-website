import { describe, expect, it } from "vitest";
import { diffOrders, mapOrders, selectPendingOrders, withLiveMarks, type KiteOrderSnapshot } from "@/lib/kite/orders";

function order(overrides: Partial<KiteOrderSnapshot> = {}): KiteOrderSnapshot {
  return {
    order_id: "1",
    tradingsymbol: "NIFTY26DEC26000PE",
    exchange: "NFO",
    transaction_type: "SELL",
    order_type: "LIMIT",
    product: "NRML",
    status: "OPEN",
    quantity: 65,
    pending_quantity: 65,
    filled_quantity: 0,
    price: 120.5,
    trigger_price: 0,
    variety: "regular",
    order_timestamp: "2026-10-16 09:20:00",
    status_message: null,
    ...overrides,
  };
}

describe("pending orders", () => {
  it("keeps open orders and drops completed, cancelled, and rejected ones", () => {
    const selected = selectPendingOrders([
      order(),
      order({ order_id: "2", status: "COMPLETE", filled_quantity: 65, pending_quantity: 0 }),
      order({ order_id: "3", status: "CANCELLED" }),
      order({ order_id: "4", status: "REJECTED", status_message: "Insufficient funds" }),
      order({ order_id: "5", status: "TRIGGER PENDING", order_type: "SL", trigger_price: 80, order_timestamp: "2026-10-16 09:30:00" }),
    ]);
    expect(selected.map((row) => row.id)).toEqual(["5", "1"]);
    expect(selected[0]).toMatchObject({ status: "TRIGGER PENDING", triggerPrice: 80, price: 120.5 });
    expect(selected[1]?.triggerPrice).toBeNull();
  });

  it("shows a market order without inventing a limit price", () => {
    const selected = selectPendingOrders([
      order({ order_type: "MARKET", price: 0, status: "OPEN PENDING", variety: "amo" }),
    ]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.orderType).toBe("MARKET");
    expect(selected[0]?.price).toBeNull();
    expect(selected[0]?.variety).toBe("amo");
  });
});

describe("order change notices", () => {
  const open = mapOrders([order()]);
  const priced = mapOrders([order({ price: 118 })]);
  const filled = mapOrders([order({ filled_quantity: 30, pending_quantity: 35 })]);
  const complete = mapOrders([order({ status: "COMPLETE", filled_quantity: 65, pending_quantity: 0 })]);
  const cancelled = mapOrders([order({ status: "CANCELLED", pending_quantity: 65 })]);
  const rejected = mapOrders([order({ status: "REJECTED", status_message: "Insufficient funds" })]);

  it("stays quiet on the first book and on an unchanged book", () => {
    expect(diffOrders(null, open)).toEqual([]);
    expect(diffOrders(open, open)).toEqual([]);
  });

  it("reports a new order, a modification, a fill, a completion, a cancel, and a rejection", () => {
    expect(diffOrders([], open).map((notice) => notice.kind)).toEqual(["new"]);
    expect(diffOrders(open, priced)[0]).toMatchObject({ kind: "modified", detail: expect.stringContaining("120.50 → 118.00") });
    expect(diffOrders(open, filled)[0]?.kind).toBe("filled");
    expect(diffOrders(open, complete)[0]?.kind).toBe("completed");
    expect(diffOrders(open, cancelled)[0]?.kind).toBe("cancelled");
    expect(diffOrders(open, rejected)[0]).toMatchObject({ kind: "rejected", detail: "Insufficient funds" });
    expect(diffOrders([], rejected)[0]).toMatchObject({ kind: "rejected", title: "Order rejected", detail: "Insufficient funds" });
    expect(diffOrders([], rejected)[0]?.detail).not.toMatch(/placed/);
  });

  it("shows the live price and its gap from the set price", () => {
    const [limit] = mapOrders([order()]);
    const marked = withLiveMarks(limit ? [limit] : [], new Map([["NFO:NIFTY26DEC26000PE", 125]]));
    expect(marked[0]?.currentPrice).toBe(125);
    expect(marked[0]?.gap).toBeCloseTo(4.5);

    const [stop] = mapOrders([order({ order_type: "SL-M", price: 0, trigger_price: 80 })]);
    const stopMarked = withLiveMarks(stop ? [stop] : [], new Map([["NFO:NIFTY26DEC26000PE", 90]]));
    expect(stopMarked[0]?.gap).toBe(10);

    const [market] = mapOrders([order({ order_type: "MARKET", price: 0 })]);
    const marketMarked = withLiveMarks(market ? [market] : [], new Map([["NFO:NIFTY26DEC26000PE", 100]]));
    expect(marketMarked[0]?.currentPrice).toBe(100);
    expect(marketMarked[0]?.gap).toBeNull();
  });
});
