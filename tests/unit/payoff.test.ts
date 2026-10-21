import { describe, expect, it } from "vitest";
import { expiryPayoff, signedPayoffSeries } from "@/lib/pricing/payoff";

describe("expiry profit and loss", () => {
  it("treats a long call as a limited loss and unlimited profit", () => {
    const profile = expiryPayoff([{ right: "CE", strike: 100, quantity: 50, multiplier: 1, entryPremium: 5 }], 100);
    expect(profile?.maxLoss).toMatchObject({ kind: "finite", pnl: -250 });
    expect(profile?.maxProfit.kind).toBe("unlimited");
  });

  it("treats a short call as a limited profit and unlimited loss", () => {
    const profile = expiryPayoff([{ right: "CE", strike: 100, quantity: -50, multiplier: 1, entryPremium: 5 }], null);
    expect(profile?.maxProfit).toMatchObject({ kind: "finite", pnl: 250 });
    expect(profile?.maxLoss.kind).toBe("unlimited");
  });

  it("finds both limits of a call spread", () => {
    const profile = expiryPayoff([
      { right: "CE", strike: 100, quantity: 50, multiplier: 1, entryPremium: 5 },
      { right: "CE", strike: 110, quantity: -50, multiplier: 1, entryPremium: 2 },
    ], 105);
    expect(profile?.maxProfit).toMatchObject({ kind: "finite", pnl: 350, spot: 110 });
    expect(profile?.maxLoss).toMatchObject({ kind: "finite", pnl: -150 });
    expect(profile?.points.some((point) => point.spot === 105)).toBe(true);
    expect(profile?.now).toBeNull();
  });

  it("puts the short-put loss at a NIFTY expiry of zero", () => {
    const profile = expiryPayoff([{ right: "PE", strike: 100, quantity: -50, multiplier: 1, entryPremium: 4 }], 100);
    expect(profile?.maxProfit.pnl).toBeCloseTo(200);
    expect(profile?.maxLoss).toMatchObject({ kind: "finite", pnl: -4800, spot: 0 });
  });

  it("splits a zero crossing so the loss and the profit can be coloured separately", () => {
    const signed = signedPayoffSeries([
      { spot: 100, pnl: -100 },
      { spot: 300, pnl: 100 },
    ]);
    expect(signed.map((point) => point.spot)).toEqual([100, 200, 300]);
    expect(signed[0]).toMatchObject({ loss: -100, gain: null });
    expect(signed[1]).toMatchObject({ pnl: 0, loss: 0, gain: 0, crossing: true });
    expect(signed[2]).toMatchObject({ loss: null, gain: 100 });
  });

  it("places the current point at the live P&L, not the expiry payoff", () => {
    const profile = expiryPayoff([
      { right: "CE", strike: 100, quantity: 50, multiplier: 1, entryPremium: 5, marketPremium: 7 },
      { right: "CE", strike: 110, quantity: -50, multiplier: 1, entryPremium: 2, marketPremium: 1 },
    ], 105);
    expect(profile?.now).toEqual({ spot: 105, pnl: 150 });
  });

  it("leaves out a contract without an average price", () => {
    const profile = expiryPayoff([
      { right: "CE", strike: 100, quantity: 50, multiplier: 1, entryPremium: 5 },
      { right: "PE", strike: 90, quantity: -50, multiplier: 1, entryPremium: null },
    ], null);
    expect(profile?.omitted).toBe(1);
    expect(profile?.maxProfit.kind).toBe("unlimited");
  });
});
