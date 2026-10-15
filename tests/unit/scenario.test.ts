import { describe, expect, it } from "vitest";
import { priceEuropean } from "@/lib/pricing/black-scholes";
import { runScenarios, ScenarioInputError, shiftedVolatility } from "@/lib/scenario/engine";
import { DEFAULT_SPOT_MOVES } from "@/lib/time";

const rate = 0.065;
const timeYears = 10 / 365;

function request(overrides: Partial<Parameters<typeof runScenarios>[0]> = {}) {
  const market = priceEuropean({
    spot: 24000,
    strike: 24100,
    timeYears,
    rate,
    dividendYield: 0,
    volatility: 0.18,
    right: "CE",
  }).premium;
  return {
    baseSpot: 24000,
    moves: [...DEFAULT_SPOT_MOVES],
    horizonDays: 0,
    ivMode: "constant" as const,
    ivPoints: 0,
    rate,
    dividendYield: 0,
    positions: [
      {
        id: "call",
        tradingSymbol: "NIFTY-CE",
        right: "CE" as const,
        strike: 24100,
        quantity: 75,
        multiplier: 1,
        entryPremium: 100,
        marketPremium: market,
        timeYears,
      },
    ],
    ...overrides,
  };
}

describe("scenario engine", () => {
  it("builds the default seven NIFTY moves and a near-zero baseline", () => {
    const result = runScenarios(request());
    expect(result.columns.map((column) => column.move)).toEqual([-500, -200, -100, 0, 100, 200, 500]);
    const flat = result.columns.find((column) => column.move === 0);
    expect(flat?.portfolioIncrementalPnl).toBeCloseTo(0, 1);
    expect(result.rows[0]?.cells.every((cell) => cell.pricing === "black-scholes")).toBe(true);
  });

  it("raises premium when IV rises by three volatility points", () => {
    expect(shiftedVolatility(0.2, "up", 3).iv).toBeCloseTo(0.23, 8);
    const constant = runScenarios(request());
    const higher = runScenarios(request({ ivMode: "up", ivPoints: 3 }));
    const base = constant.rows[0]?.cells.find((_, index) => constant.moves[index] === 0);
    const shifted = higher.rows[0]?.cells.find((_, index) => higher.moves[index] === 0);
    expect((shifted?.theoreticalPremium ?? 0) > (base?.theoreticalPremium ?? 0)).toBe(true);
  });

  it("uses the expiry payoff inside the horizon and keeps a short sign", () => {
    const result = runScenarios(
      request({
        horizonDays: 30,
        positions: [
          {
            id: "put",
            tradingSymbol: "NIFTY-PE",
            right: "PE",
            strike: 24100,
            quantity: -50,
            multiplier: 1,
            entryPremium: 80,
            marketPremium: 40,
            timeYears: 2 / 365,
          },
        ],
      }),
    );
    const down = result.rows[0]?.cells[0];
    expect(down?.pricing).toBe("expiry-payoff");
    expect(down?.theoreticalPremium).toBe(Math.max(0, 24100 - (24000 - 500)));
    expect(down?.incrementalPnl).toBe(-50 * ((down?.theoreticalPremium ?? 0) - 40));
    expect(priceWouldRejectNegative()).toBe(true);
  });

  it("aggregates long and short contributions and leaves a missing quote unpriced", () => {
    const priced = request();
    const result = runScenarios({
      ...priced,
      positions: [
        priced.positions[0],
        {
          id: "missing",
          tradingSymbol: "NIFTY-MISSING",
          right: "PE",
          strike: 24000,
          quantity: 25,
          multiplier: 1,
          entryPremium: 10,
          marketPremium: null,
          timeYears,
        },
      ],
    });
    const missing = result.rows[1]?.cells[3];
    expect(missing?.pricing).toBe("unavailable");
    expect(missing?.theoreticalPremium).toBeNull();
    expect(result.columns[3]?.incrementalComplete).toBe(false);
    expect(result.currentGreeks.complete).toBe(false);
    const only = runScenarios(priced);
    expect(only.currentGreeks.delta).toBeCloseTo(only.positionGreeks[0]?.delta ?? 0, 8);
  });

  it("rejects invalid scenario input", () => {
    expect(() => runScenarios(request({ moves: [] }))).toThrow(ScenarioInputError);
    expect(() => runScenarios(request({ baseSpot: 0 }))).toThrow(ScenarioInputError);
    expect(() => runScenarios(request({ horizonDays: -1 }))).toThrow(ScenarioInputError);
  });
});

function priceWouldRejectNegative() {
  try {
    priceEuropean({
      spot: 1,
      strike: 1,
      timeYears: -1,
      rate: 0,
      dividendYield: 0,
      volatility: 0.2,
      right: "CE",
    });
    return false;
  } catch {
    return true;
  }
}
