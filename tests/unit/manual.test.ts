import { describe, expect, it } from "vitest";
import { includedScenarioPositions, isBlankManualDraft, prepareManualLeg, type ManualEntry } from "@/lib/manual/book";
import { runScenarios } from "@/lib/scenario/engine";
import { DEFAULT_SPOT_MOVES } from "@/lib/time";

const now = new Date("2026-10-15T10:00:00+05:30");

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    id: "put",
    symbol: "NIFTY26DEC22000PE",
    quantity: "-650",
    average: "120",
    price: "98",
    expiry: "2026-12-29",
    included: true,
    ...overrides,
  };
}

describe("manual book", () => {
  it("prices a monthly symbol from the expiry date, quantity, average and current price", () => {
    const leg = prepareManualLeg(entry(), now);
    expect(leg.error).toBeNull();
    expect(leg.position).toMatchObject({
      tradingSymbol: "NIFTY26DEC22000PE",
      right: "PE",
      strike: 22000,
      quantity: -650,
      entryPremium: 120,
      marketPremium: 98,
      multiplier: 1,
    });
    expect(leg.side).toBe("short");
    expect(leg.position?.timeYears).toBeGreaterThan(0);
  });

  it("requires an expiry day when the symbol only names the month", () => {
    const leg = prepareManualLeg(entry({ expiry: "" }), now);
    expect(leg.position).toBeNull();
    expect(leg.error).toMatch(/December 2026/);
  });

  it("reads a weekly expiry from the symbol", () => {
    const leg = prepareManualLeg(
      entry({
        symbol: "NIFTY25O1424200CE",
        quantity: "75",
        expiry: "",
      }),
      new Date("2025-10-01T10:00:00+05:30"),
    );
    expect(leg.expiry).toBe("2025-10-14");
    expect(leg.expiryFromSymbol).toBe(true);
    expect(leg.optionType).toBe("CE");
    expect(leg.side).toBe("long");
  });

  it("recognises the empty opening form so a refresh cannot erase a saved book", () => {
    expect(isBlankManualDraft([entry()], "")).toBe(false);
    expect(
      isBlankManualDraft(
        [{ id: "draft", symbol: "", quantity: "", average: "", price: "", expiry: "", included: true }],
        "",
      ),
    ).toBe(true);
  });

  it("leaves an excluded contract out of the scenario", () => {
    const rows = [entry(), entry({ id: "other", symbol: "NIFTY26DEC23000CE", quantity: "75", included: false })];
    const legs = rows.map((row) => prepareManualLeg(row, now));
    const positions = includedScenarioPositions(rows, legs);
    expect(positions.map((position) => position.id)).toEqual(["put"]);
    const scenario = runScenarios({
      baseSpot: 25200,
      moves: [...DEFAULT_SPOT_MOVES],
      horizonDays: 0,
      ivMode: "constant",
      ivPoints: 0,
      rate: 0.065,
      dividendYield: 0,
      positions,
    });
    expect(scenario.rows).toHaveLength(1);
    expect(scenario.decay.map((point) => point.horizonDays)).toEqual([1, 3, 7]);
    expect(scenario.positionGreeks[0]?.delta).not.toBeNull();
  });
});
