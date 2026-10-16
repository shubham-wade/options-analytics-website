import { describe, expect, it } from "vitest";
import { applyChargeTotals, chargeRequests, summarizeCharges, totalsFromNotes, withOrderCharges } from "@/lib/kite/charges";
import { mapOrders, type KiteOrderSnapshot } from "@/lib/kite/orders";

function order(overrides: Partial<KiteOrderSnapshot> = {}): KiteOrderSnapshot {
  return {
    order_id: "9",
    tradingsymbol: "NIFTY26DEC26000PE",
    exchange: "NFO",
    transaction_type: "BUY",
    order_type: "MARKET",
    product: "NRML",
    status: "COMPLETE",
    quantity: 65,
    pending_quantity: 0,
    filled_quantity: 65,
    price: 0,
    trigger_price: 0,
    variety: "regular",
    order_timestamp: "2026-10-16 10:00:00",
    status_message: null,
    average_price: 121.25,
    ...overrides,
  };
}

describe("order charges", () => {
  const completed = mapOrders([order(), order({ order_id: "8", status: "OPEN", average_price: 10 })]);

  it("asks Zerodha only for completed fills with an average price", () => {
    const requests = chargeRequests(completed);
    expect(requests.map((request) => request.order_id)).toEqual(["9"]);
    expect(requests[0]).toMatchObject({ quantity: 65, average_price: 121.25, exchange: "NFO" });
    expect(chargeRequests(mapOrders([order({ average_price: 0 })]))).toEqual([]);
  });

  it("keeps each total with the order that was sent in that position", () => {
    const requests = chargeRequests(completed);
    expect(totalsFromNotes(requests, [{ charges: { total: 18.4 } }])).toEqual({ "9": 18.4 });
    expect(totalsFromNotes(requests, [])).toBeNull();
    expect(applyChargeTotals(completed, { "9": 18.4 }).find((row) => row.id === "9")?.charges).toBe(18.4);
    expect(applyChargeTotals(completed, { "9": 18.4 }).find((row) => row.id === "8")?.charges).toBeNull();
  });

  it("sums known charges and marks a missing fill as partial", () => {
    const [first, second] = mapOrders([order(), order({ order_id: "7" })]);
    expect(summarizeCharges(null)).toEqual({ total: null, complete: false, count: 0 });
    expect(summarizeCharges([])).toEqual({ total: 0, complete: true, count: 0 });
    expect(summarizeCharges(applyChargeTotals([first, second].filter(Boolean) as typeof completed, { "9": 10, "7": 2.5 }))).toMatchObject({
      total: 12.5,
      complete: true,
      count: 2,
    });
    expect(summarizeCharges(applyChargeTotals([first].filter(Boolean) as typeof completed, {})).complete).toBe(false);
  });

  it("reuses a fresh charge result for the same fills", async () => {
    let calls = 0;
    const client = {
      async getvirtualContractNote() {
        calls += 1;
        return [{ charges: { total: 4.25 } }];
      },
    };
    const first = await withOrderCharges(client, completed, "charges-test-session", 1_000);
    const second = await withOrderCharges(client, completed, "charges-test-session", 5_000);
    expect(first.find((row) => row.id === "9")?.charges).toBe(4.25);
    expect(second.find((row) => row.id === "9")?.charges).toBe(4.25);
    expect(calls).toBe(1);
  });
});
