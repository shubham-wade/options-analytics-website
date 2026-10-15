export interface DirectionPosition {
  id: string;
  optionType: "CE" | "PE";
  side: "long" | "short";
  quantity: number;
}

export interface DirectionGreek {
  id: string;
  delta: number | null;
}

export interface DirectionMix {
  bullishCount: number;
  bearishCount: number;
  bullishDelta: number;
  bearishDelta: number;
  missingDelta: number;
  /** Rounded share of the chosen basis. The two percentages add to 100 when present. */
  bullishPercent: number | null;
  bearishPercent: number | null;
  /** Exact 0–1 share used to draw the bar. */
  bullishShare: number | null;
  basis: "delta" | "count" | "empty";
}

/** Long calls and short puts are bullish. Long puts and short calls are bearish. */
export function isBullishPosition(position: Pick<DirectionPosition, "optionType" | "side">): boolean {
  return position.optionType === "CE" ? position.side === "long" : position.side === "short";
}

export function directionMix(positions: DirectionPosition[], greeks: DirectionGreek[]): DirectionMix {
  const open = positions.filter((position) => position.quantity !== 0);
  const deltaById = new Map(greeks.map((row) => [row.id, row.delta]));
  let bullishCount = 0;
  let bearishCount = 0;
  let bullishDelta = 0;
  let bearishDelta = 0;
  let missingDelta = 0;

  for (const position of open) {
    if (isBullishPosition(position)) bullishCount += 1;
    else bearishCount += 1;

    const delta = deltaById.get(position.id);
    if (delta === undefined || delta === null || !Number.isFinite(delta)) {
      missingDelta += 1;
      continue;
    }
    if (delta > 0) bullishDelta += delta;
    else if (delta < 0) bearishDelta += Math.abs(delta);
  }

  const empty: DirectionMix = {
    bullishCount,
    bearishCount,
    bullishDelta,
    bearishDelta,
    missingDelta,
    bullishPercent: null,
    bearishPercent: null,
    bullishShare: null,
    basis: "empty",
  };

  const deltaTotal = bullishDelta + bearishDelta;
  if (deltaTotal > 0) {
    return withShares(empty, bullishDelta / deltaTotal, "delta");
  }

  const countTotal = bullishCount + bearishCount;
  if (countTotal > 0) {
    return withShares(empty, bullishCount / countTotal, "count");
  }

  return empty;
}

function withShares(base: DirectionMix, bullishShare: number, basis: "delta" | "count"): DirectionMix {
  const bullishPercent = Math.round(bullishShare * 100);
  return {
    ...base,
    bullishPercent,
    bearishPercent: 100 - bullishPercent,
    bullishShare,
    basis,
  };
}
