import { describe, expect, it } from "vitest";
import {
  implyVolatility,
  normalCdf,
  priceEuropean,
  PricingInputError,
  undiscountedIntrinsic,
} from "@/lib/pricing/black-scholes";
import { kiteDayPnl, markedFromClosePnl, positionPnl } from "@/lib/pricing/pnl";

const base = {
  spot: 100,
  strike: 100,
  timeYears: 1,
  rate: 0.05,
  dividendYield: 0,
  volatility: 0.2,
};

describe("Black–Scholes–Merton", () => {
  it("prices the Hull call and put and satisfies put-call parity", () => {
    const inputs = { spot: 42, strike: 40, timeYears: 0.5, rate: 0.1, dividendYield: 0, volatility: 0.2 };
    const call = priceEuropean({ ...inputs, right: "CE" });
    const put = priceEuropean({ ...inputs, right: "PE" });
    expect(call.premium).toBeCloseTo(4.76, 2);
    expect(put.premium).toBeCloseTo(0.81, 2);
    const parity = inputs.spot * Math.exp(-inputs.dividendYield * inputs.timeYears) -
      inputs.strike * Math.exp(-inputs.rate * inputs.timeYears);
    expect(call.premium - put.premium).toBeCloseTo(parity, 8);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it("matches finite-difference delta, gamma, theta and vega units", () => {
    const call = priceEuropean({ ...base, right: "CE" });
    const dS = 0.25;
    const up = priceEuropean({ ...base, spot: base.spot + dS, right: "CE" }).premium;
    const down = priceEuropean({ ...base, spot: base.spot - dS, right: "CE" }).premium;
    const mid = call.premium;
    expect((up - down) / (2 * dS)).toBeCloseTo(call.delta, 3);
    expect((up - 2 * mid + down) / (dS * dS)).toBeCloseTo(call.gamma, 3);

    const h = 0.01;
    const volUp = priceEuropean({ ...base, volatility: base.volatility + h, right: "CE" }).premium;
    const volDown = priceEuropean({ ...base, volatility: base.volatility - h, right: "CE" }).premium;
    expect((volUp - volDown) / 2).toBeCloseTo(call.vegaPerPoint, 4);

    const day = 1 / 365;
    const later = priceEuropean({ ...base, timeYears: base.timeYears - day, right: "CE" }).premium;
    expect(later - mid).toBeCloseTo(call.thetaPerDay, 4);
    expect(call.thetaPerDay).toBeLessThan(0);
  });

  it("calibrates implied volatility and refuses a premium below the lower bound", () => {
    const call = priceEuropean({ ...base, right: "CE" });
    const implied = implyVolatility({ ...base, right: "CE" }, call.premium);
    expect(implied.status).toBe("calibrated");
    expect(implied.volatility).toBeCloseTo(0.2, 4);

    const below = implyVolatility(
      { spot: 100, strike: 90, timeYears: 0.1, rate: 0, dividendYield: 0, right: "CE" },
      1,
    );
    expect(below.volatility).toBeNull();
    expect(below.status).toBe("below-bounds");
  });

  it("rejects negative time instead of pricing it", () => {
    expect(() => priceEuropean({ ...base, timeYears: -0.01, right: "PE" })).toThrow(PricingInputError);
  });
});

describe("position P&L", () => {
  it("uses signed quantity once for long and short trades", () => {
    const long = positionPnl({ quantity: 75, multiplier: 1, entryPremium: 100, exitPremium: 80, currentPremium: 90 });
    const short = positionPnl({ quantity: -75, multiplier: 1, entryPremium: 100, exitPremium: 80, currentPremium: 90 });
    expect(long.tradePnl).toBe(75 * (80 - 100));
    expect(short.tradePnl).toBe(-75 * (80 - 100));
    expect(short.tradePnl).toBe(75 * (100 - 80));
    expect(long.incrementalPnl).toBe(75 * (80 - 90));
    expect(short.incrementalPnl).toBe(-75 * (80 - 90));
    expect(long.tradePnl).not.toBe(75 * 75 * (80 - 100));
  });

  it("does not invent an entry premium", () => {
    const result = positionPnl({ quantity: 75, multiplier: 1, entryPremium: null, exitPremium: 80, currentPremium: 90 });
    expect(result.tradePnl).toBeNull();
    expect(result.incrementalPnl).toBe(75 * (80 - 90));
  });
});

describe("day P&L", () => {
  it("marks an untouched overnight position from the previous close", () => {
    expect(
      kiteDayPnl({
        quantity: 75,
        overnightQuantity: 75,
        multiplier: 1,
        closePrice: 110,
        dayBuyValue: 0,
        daySellValue: 0,
        markPrice: 130,
      }),
    ).toBe(1500);
  });

  it("includes a same-day round trip that is flat", () => {
    expect(
      kiteDayPnl({
        quantity: 0,
        overnightQuantity: 0,
        multiplier: 1,
        closePrice: 110,
        dayBuyValue: 7500,
        daySellValue: 8250,
        markPrice: 130,
      }),
    ).toBe(750);
  });

  it("marks a manual quantity from the previous close to the live price", () => {
    expect(markedFromClosePnl(-65, 98, 110)).toBe(-65 * (98 - 110));
    expect(markedFromClosePnl(65, 98, null)).toBeNull();
  });
});
