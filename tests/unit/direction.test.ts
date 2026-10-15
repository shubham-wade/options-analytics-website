import { describe, expect, it } from "vitest";
import { directionMix, isBullishPosition } from "@/lib/risk/direction";

describe("directional mix", () => {
  it("treats long calls and short puts as bullish", () => {
    expect(isBullishPosition({ optionType: "CE", side: "long" })).toBe(true);
    expect(isBullishPosition({ optionType: "PE", side: "short" })).toBe(true);
    expect(isBullishPosition({ optionType: "CE", side: "short" })).toBe(false);
    expect(isBullishPosition({ optionType: "PE", side: "long" })).toBe(false);
  });

  it("weights the percentage by absolute delta", () => {
    const mix = directionMix(
      [
        { id: "call", optionType: "CE", side: "long", quantity: 75 },
        { id: "put", optionType: "PE", side: "long", quantity: 150 },
      ],
      [
        { id: "call", delta: 30 },
        { id: "put", delta: -10 },
      ],
    );
    expect(mix.basis).toBe("delta");
    expect(mix.bullishPercent).toBe(75);
    expect(mix.bearishPercent).toBe(25);
    expect(mix.bullishCount).toBe(1);
    expect(mix.bearishCount).toBe(1);
    expect(mix.bullishShare).toBeCloseTo(0.75, 8);
  });

  it("falls back to a position count when delta is missing", () => {
    const mix = directionMix(
      [
        { id: "a", optionType: "CE", side: "short", quantity: -75 },
        { id: "b", optionType: "CE", side: "short", quantity: -75 },
        { id: "c", optionType: "PE", side: "short", quantity: -75 },
      ],
      [],
    );
    expect(mix.basis).toBe("count");
    expect(mix.bullishPercent).toBe(33);
    expect(mix.bearishPercent).toBe(67);
    expect(mix.missingDelta).toBe(3);
  });

  it("ignores flat contracts", () => {
    const mix = directionMix([{ id: "flat", optionType: "CE", side: "long", quantity: 0 }], [{ id: "flat", delta: 0 }]);
    expect(mix.basis).toBe("empty");
    expect(mix.bullishCount).toBe(0);
  });
});
