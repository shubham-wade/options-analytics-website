import { describe, expect, it } from "vitest";
import { isCompleteOrder, mapOrders, type KiteOrderSnapshot } from "@/lib/kite/orders";
import { alignPrice, parseOrderCommand, positionOrderIntent, quantityFitsLot } from "@/lib/kite/order-actions";

const place = {
  action: "place",
  confirm: true,
  symbol: "NIFTY26DEC26000PE",
  side: "SELL",
  quantity: 65,
  product: "NRML",
  orderType: "LIMIT",
  price: 120.5,
  triggerPrice: null,
  variety: "regular",
};

describe("order commands", () => {
  it("rejects a request that was not confirmed", () => {
    const parsed = parseOrderCommand({ ...place, confirm: false });
    expect(parsed.ok).toBe(false);
  });

  it("accepts a confirmed NIFTY limit order and drops unused prices", () => {
    const parsed = parseOrderCommand(place);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.command).toMatchObject({ action: "place", symbol: "NIFTY26DEC26000PE", price: 120.5, triggerPrice: null });
    }
  });

  it("refuses a symbol that is not a NIFTY option", () => {
    const parsed = parseOrderCommand({ ...place, symbol: "RELIANCE" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/NIFTY/);
  });

  it("requires a price for a limit and a trigger for a stop", () => {
    expect(parseOrderCommand({ ...place, price: "" }).ok).toBe(false);
    expect(parseOrderCommand({ ...place, orderType: "SL", triggerPrice: null }).ok).toBe(false);
    const market = parseOrderCommand({ ...place, orderType: "MARKET", price: 10, triggerPrice: 10 });
    expect(market.ok).toBe(true);
    if (market.ok && market.command.action === "place") {
      expect(market.command.price).toBeNull();
      expect(market.command.triggerPrice).toBeNull();
    }
  });

  it("allows modify and cancel only for varieties this page can send", () => {
    expect(
      parseOrderCommand({ action: "modify", confirm: true, orderId: "123", variety: "iceberg", quantity: 65, orderType: "LIMIT", price: 100 }).ok,
    ).toBe(false);
    const modify = parseOrderCommand({
      action: "modify",
      confirm: true,
      orderId: "123",
      variety: "amo",
      quantity: 65,
      orderType: "SL-M",
      triggerPrice: 80,
    });
    expect(modify.ok).toBe(true);
    expect(parseOrderCommand({ action: "cancel", confirm: true, orderId: "abc", variety: "regular" }).ok).toBe(false);
    expect(parseOrderCommand({ action: "cancel", confirm: true, orderId: "123", variety: "regular" }).ok).toBe(true);
  });

  it("exits the whole position and adds one lot on the same side", () => {
    expect(positionOrderIntent({ quantity: 130, product: "NRML", lotSize: 65 }, "exit")).toMatchObject({
      ok: true,
      intent: { side: "SELL", quantity: 130, product: "NRML" },
    });
    expect(positionOrderIntent({ quantity: -65, product: "MIS", lotSize: 65 }, "exit")).toMatchObject({
      ok: true,
      intent: { side: "BUY", quantity: 65 },
    });
    expect(positionOrderIntent({ quantity: -130, product: "NRML", lotSize: 65 }, "add")).toMatchObject({
      ok: true,
      intent: { side: "SELL", quantity: 65 },
    });
    expect(positionOrderIntent({ quantity: 0, product: "NRML", lotSize: 65 }, "exit").ok).toBe(false);
    expect(positionOrderIntent({ quantity: 65, product: "CNC", lotSize: 65 }, "add").ok).toBe(false);
  });

  it("rounds a limit onto the option tick", () => {
    expect(alignPrice(12.13, 0.05)).toBe(12.15);
    expect(alignPrice(12.12, 0.05)).toBe(12.1);
    expect(alignPrice(98.05, 0.05)).toBe(98.05);
  });

  it("checks quantity against the lot size", () => {
    expect(quantityFitsLot(65, 65)).toBe(true);
    expect(quantityFitsLot(30, 65)).toBe(false);
    expect(quantityFitsLot(10, null)).toBe(true);
  });
});

describe("completed orders", () => {
  it("keeps only orders Kite has marked complete and keeps the average price", () => {
    const snapshot = (status: string, id: string): KiteOrderSnapshot => ({
      order_id: id,
      tradingsymbol: "NIFTY26DEC26000PE",
      exchange: "NFO",
      transaction_type: "BUY",
      order_type: "MARKET",
      product: "NRML",
      status,
      quantity: 65,
      pending_quantity: status === "COMPLETE" ? 0 : 65,
      filled_quantity: status === "COMPLETE" ? 65 : 0,
      price: 0,
      trigger_price: 0,
      variety: "regular",
      order_timestamp: "2026-10-16 10:00:00",
      status_message: null,
      average_price: status === "COMPLETE" ? 121.25 : 0,
    });
    const mapped = mapOrders([snapshot("COMPLETE", "9"), snapshot("OPEN", "8"), snapshot("CANCELLED", "7")]);
    expect(mapped.filter(isCompleteOrder).map((order) => order.id)).toEqual(["9"]);
    expect(mapped.find((order) => order.id === "9")?.averagePrice).toBe(121.25);
  });
});
