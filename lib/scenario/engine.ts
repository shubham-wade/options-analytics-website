import {
  implyVolatility,
  priceEuropean,
  undiscountedIntrinsic,
  type OptionRight,
  type OptionValue,
} from "@/lib/pricing/black-scholes";
import { positionPnl, sumNullable } from "@/lib/pricing/pnl";
import { MODEL_DISCLAIMER, SETTLEMENT_ASSUMPTION } from "@/lib/time";

const EXPIRY_EPSILON_YEARS = 1 / (365 * 24 * 60 * 60);

export type IvMode = "constant" | "up" | "down";
export type PricingMethod = "black-scholes" | "expiry-payoff" | "unavailable";

export interface ScenarioPosition {
  id: string;
  tradingSymbol: string;
  right: OptionRight;
  strike: number;
  /** Signed quantity in option units. */
  quantity: number;
  multiplier: number;
  entryPremium: number | null;
  /** Observed premium used to calibrate IV and as the incremental baseline. */
  marketPremium: number | null;
  /** Time to expiry from the valuation instant, in ACT/365 years, before the horizon. */
  timeYears: number;
}

export interface ScenarioRequest {
  baseSpot: number;
  moves: number[];
  horizonDays: number;
  ivMode: IvMode;
  /** Volatility points. 3 moves 20% to 23%. */
  ivPoints: number;
  rate: number;
  dividendYield: number;
  positions: ScenarioPosition[];
}

export interface ScenarioCell {
  theoreticalPremium: number | null;
  premiumChange: number | null;
  incrementalPnl: number | null;
  tradePnl: number | null;
  pricing: PricingMethod;
  ivUsed: number | null;
  warnings: string[];
}

export interface ScenarioColumn {
  move: number;
  spot: number;
  portfolioIncrementalPnl: number | null;
  portfolioTradePnl: number | null;
  incrementalComplete: boolean;
  tradeComplete: boolean;
}

export interface DecayPoint {
  horizonDays: number;
  spot: number;
  incrementalPnl: number | null;
  complete: boolean;
}

export interface Breakeven {
  /** Index points from the starting spot. */
  move: number;
  spot: number;
  fromMove: number;
  toMove: number;
}

const DECAY_HORIZONS = [1, 3, 7] as const;

export interface PositionGreeks {
  id: string;
  iv: number | null;
  ivStatus: string;
  delta: number | null;
  gamma: number | null;
  thetaPerDay: number | null;
  vegaPerPoint: number | null;
  modelPremium: number | null;
  intrinsic: number | null;
  timeValue: number | null;
  warnings: string[];
}

export interface PortfolioGreeks {
  delta: number | null;
  gamma: number | null;
  thetaPerDay: number | null;
  vegaPerPoint: number | null;
  complete: boolean;
  valuedPositions: number;
}

export interface ScenarioRow {
  id: string;
  tradingSymbol: string;
  side: "long" | "short";
  /** Signed quantity in option units, matching the Positions table. */
  quantity: number;
  cells: ScenarioCell[];
}

export interface ScenarioResult {
  baseSpot: number;
  moves: number[];
  horizonDays: number;
  ivMode: IvMode;
  ivPoints: number;
  rate: number;
  dividendYield: number;
  columns: ScenarioColumn[];
  rows: ScenarioRow[];
  currentGreeks: PortfolioGreeks;
  positionGreeks: PositionGreeks[];
  warnings: string[];
  settlementAssumption: string;
  disclaimer: string;
  /** Unchanged spot and unchanged IV at 1, 3 and 7 calendar days. */
  decay: DecayPoint[];
  breakevens: Breakeven[];
}

export class ScenarioInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioInputError";
  }
}

export function shiftedVolatility(iv: number, mode: IvMode, points: number): { iv: number; warning: string | null } {
  const shift = points / 100;
  if (mode === "up") return { iv: iv + shift, warning: null };
  if (mode === "down") {
    const next = iv - shift;
    if (next <= 0.0001) {
      return {
        iv: 0.0001,
        warning: "The IV reduction was floored at 0.01 volatility points so volatility stays positive.",
      };
    }
    return { iv: next, warning: null };
  }
  return { iv, warning: null };
}

export function validateScenarioRequest(input: ScenarioRequest): void {
  if (!Number.isFinite(input.baseSpot) || input.baseSpot <= 0) {
    throw new ScenarioInputError("Starting NIFTY spot must be a positive number.");
  }
  if (!Array.isArray(input.moves) || input.moves.length < 1 || input.moves.length > 15) {
    throw new ScenarioInputError("Provide between 1 and 15 scenario moves.");
  }
  for (const move of input.moves) {
    if (!Number.isFinite(move) || move < -5000 || move > 5000) {
      throw new ScenarioInputError("Each scenario move must be a finite number between -5000 and 5000.");
    }
  }
  if (!Number.isFinite(input.horizonDays) || input.horizonDays < 0 || input.horizonDays > 3650) {
    throw new ScenarioInputError("Horizon must be between 0 and 3650 calendar days.");
  }
  if (input.ivMode !== "constant" && input.ivMode !== "up" && input.ivMode !== "down") {
    throw new ScenarioInputError("IV mode must be constant, up or down.");
  }
  if (!Number.isFinite(input.ivPoints) || input.ivPoints < 0 || input.ivPoints > 200) {
    throw new ScenarioInputError("IV shift must be between 0 and 200 volatility points.");
  }
  if (!Number.isFinite(input.rate) || input.rate < -0.05 || input.rate > 0.5) {
    throw new ScenarioInputError("Interest rate must be between -5% and 50%.");
  }
  if (!Number.isFinite(input.dividendYield) || input.dividendYield < -0.05 || input.dividendYield > 0.5) {
    throw new ScenarioInputError("Dividend yield must be between -5% and 50%.");
  }
}

function scaleGreeks(value: OptionValue, quantity: number, multiplier: number) {
  const scale = quantity * multiplier;
  return {
    delta: value.delta * scale,
    gamma: value.gamma * scale,
    thetaPerDay: value.thetaPerDay * scale,
    vegaPerPoint: value.vegaPerPoint * scale,
  };
}

function unavailableCell(warnings: string[]): ScenarioCell {
  return {
    theoreticalPremium: null,
    premiumChange: null,
    incrementalPnl: null,
    tradePnl: null,
    pricing: "unavailable",
    ivUsed: null,
    warnings,
  };
}

export function findBreakevens(columns: ScenarioColumn[]): Breakeven[] {
  const ordered = [...columns].sort((left, right) => left.move - right.move);
  const found: Breakeven[] = [];
  const seen = new Set<string>();
  const add = (move: number, spot: number, fromMove: number, toMove: number) => {
    const key = move.toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ move, spot, fromMove, toMove });
  };

  for (const column of ordered) {
    if (!column.incrementalComplete || column.portfolioIncrementalPnl !== 0) continue;
    add(column.move, column.spot, column.move, column.move);
  }

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index];
    const right = ordered[index + 1];
    const start = left.portfolioIncrementalPnl;
    const end = right.portfolioIncrementalPnl;
    if (!left.incrementalComplete || !right.incrementalComplete || start === null || end === null) continue;
    if (start === 0 || end === 0 || start > 0 === end > 0) continue;
    const weight = start / (start - end);
    add(
      left.move + weight * (right.move - left.move),
      left.spot + weight * (right.spot - left.spot),
      left.move,
      right.move,
    );
  }

  return found;
}

function unchangedSpotDecay(input: ScenarioRequest): DecayPoint[] {
  return DECAY_HORIZONS.map((horizonDays) => {
    const result = priceScenarios(
      { ...input, moves: [0], horizonDays, ivMode: "constant", ivPoints: 0 },
      false,
    );
    const column = result.columns[0];
    return {
      horizonDays,
      spot: input.baseSpot,
      incrementalPnl: column?.portfolioIncrementalPnl ?? null,
      complete: column?.incrementalComplete ?? false,
    };
  });
}

export function runScenarios(input: ScenarioRequest): ScenarioResult {
  return priceScenarios(input, true);
}

function priceScenarios(input: ScenarioRequest, withSideViews: boolean): ScenarioResult {
  validateScenarioRequest(input);
  const warnings: string[] = [];
  const positionGreeks: PositionGreeks[] = [];

  const prepared = input.positions.map((position) => {
    const rowWarnings: string[] = [];
    if (!Number.isFinite(position.strike) || position.strike <= 0) {
      rowWarnings.push("Strike is missing, so this contract cannot be priced.");
    }
    if (!Number.isFinite(position.timeYears)) {
      rowWarnings.push("Expiry is missing, so this contract cannot be priced.");
    }
    let iv: number | null = null;
    let ivStatus = "unavailable";
    if (
      position.marketPremium !== null &&
      position.marketPremium > 0 &&
      Number.isFinite(position.timeYears) &&
      position.timeYears > EXPIRY_EPSILON_YEARS &&
      position.strike > 0
    ) {
      const implied = implyVolatility(
        {
          spot: input.baseSpot,
          strike: position.strike,
          timeYears: position.timeYears,
          rate: input.rate,
          dividendYield: input.dividendYield,
          right: position.right,
        },
        position.marketPremium,
      );
      iv = implied.volatility;
      ivStatus = implied.status;
      if (!iv) {
        rowWarnings.push(
          implied.status === "below-bounds"
            ? `The live premium ${position.marketPremium?.toFixed(2)} is below the model minimum of ${implied.lowerBound.toFixed(2)} for this spot and strike, so IV and Greeks were not invented.`
            : implied.status === "above-bounds"
              ? `The live premium ${position.marketPremium?.toFixed(2)} is above the model maximum of ${implied.upperBound.toFixed(2)} for this spot and strike, so IV and Greeks were not invented.`
              : "Implied volatility could not be calibrated from the live premium, so Greeks were not calculated.",
        );
      }
    } else if (position.marketPremium === null) {
      ivStatus = "no-premium";
      rowWarnings.push("No valid quote was available, so implied volatility was not calibrated.");
    } else if (position.timeYears <= EXPIRY_EPSILON_YEARS) {
      ivStatus = "expired";
      rowWarnings.push("The contract is already at expiry, so implied volatility is not defined.");
    }

    let greeks: PositionGreeks = {
      id: position.id,
      iv,
      ivStatus,
      delta: null,
      gamma: null,
      thetaPerDay: null,
      vegaPerPoint: null,
      modelPremium: null,
      intrinsic: Number.isFinite(position.strike)
        ? undiscountedIntrinsic(position.right, input.baseSpot, position.strike)
        : null,
      timeValue: null,
      warnings: rowWarnings,
    };

    if (iv !== null && position.timeYears > EXPIRY_EPSILON_YEARS && position.strike > 0) {
      const priced = priceEuropean({
        spot: input.baseSpot,
        strike: position.strike,
        timeYears: position.timeYears,
        rate: input.rate,
        dividendYield: input.dividendYield,
        volatility: iv,
        right: position.right,
      });
      const scaled = scaleGreeks(priced, position.quantity, position.multiplier);
      greeks = {
        ...greeks,
        ...scaled,
        modelPremium: priced.premium,
        intrinsic: priced.intrinsic,
        timeValue: priced.timeValue,
      };
    }

    positionGreeks.push(greeks);
    return { position, iv, rowWarnings };
  });

  const rows = prepared.map(({ position, iv, rowWarnings }) => {
    const cells = input.moves.map((move) => {
      const spot = input.baseSpot + move;
      if (!Number.isFinite(spot) || spot <= 0) {
        return unavailableCell(["Scenario spot is not positive."]);
      }
      if (!Number.isFinite(position.timeYears) || position.strike <= 0) {
        return unavailableCell(rowWarnings);
      }
      const remaining = position.timeYears - input.horizonDays / 365;
      const cellWarnings = [...rowWarnings];

      if (remaining <= EXPIRY_EPSILON_YEARS) {
        const theoreticalPremium = undiscountedIntrinsic(position.right, spot, position.strike);
        const pnl = positionPnl({
          quantity: position.quantity,
          multiplier: position.multiplier,
          entryPremium: position.entryPremium,
          exitPremium: theoreticalPremium,
          currentPremium: position.marketPremium,
        });
        cellWarnings.push("Priced with the expiry payoff because no time remains after the horizon.");
        if (pnl.tradeUnavailableReason) cellWarnings.push(pnl.tradeUnavailableReason);
        return {
          theoreticalPremium,
          premiumChange:
            position.marketPremium === null ? null : theoreticalPremium - position.marketPremium,
          incrementalPnl: pnl.incrementalPnl,
          tradePnl: pnl.tradePnl,
          pricing: "expiry-payoff" as const,
          ivUsed: null,
          warnings: cellWarnings,
        };
      }

      if (iv === null) {
        return unavailableCell(cellWarnings);
      }
      const shifted = shiftedVolatility(iv, input.ivMode, input.ivPoints);
      if (shifted.warning) cellWarnings.push(shifted.warning);
      const priced = priceEuropean({
        spot,
        strike: position.strike,
        timeYears: remaining,
        rate: input.rate,
        dividendYield: input.dividendYield,
        volatility: shifted.iv,
        right: position.right,
      });
      const pnl = positionPnl({
        quantity: position.quantity,
        multiplier: position.multiplier,
        entryPremium: position.entryPremium,
        exitPremium: priced.premium,
        currentPremium: position.marketPremium,
      });
      if (pnl.tradeUnavailableReason) cellWarnings.push(pnl.tradeUnavailableReason);
      return {
        theoreticalPremium: priced.premium,
        premiumChange: position.marketPremium === null ? null : priced.premium - position.marketPremium,
        incrementalPnl: pnl.incrementalPnl,
        tradePnl: pnl.tradePnl,
        pricing: "black-scholes" as const,
        ivUsed: shifted.iv,
        warnings: cellWarnings,
      };
    });
    return {
      id: position.id,
      tradingSymbol: position.tradingSymbol,
      side: position.quantity < 0 ? "short" : "long",
      quantity: position.quantity,
      cells,
    };
  });

  const columns: ScenarioColumn[] = input.moves.map((move, index) => {
    const incremental = sumNullable(rows.map((row) => row.cells[index]?.incrementalPnl ?? null));
    const trade = sumNullable(rows.map((row) => row.cells[index]?.tradePnl ?? null));
    return {
      move,
      spot: input.baseSpot + move,
      portfolioIncrementalPnl: incremental.total,
      portfolioTradePnl: trade.total,
      incrementalComplete: incremental.complete,
      tradeComplete: trade.complete,
    };
  });

  const greekFields = ["delta", "gamma", "thetaPerDay", "vegaPerPoint"] as const;
  const currentGreeks = greekFields.reduce(
    (acc, field) => {
      const summed = sumNullable(positionGreeks.map((row) => row[field]));
      acc[field] = summed.total;
      acc.complete = acc.complete && summed.complete;
      return acc;
    },
    {
      delta: null as number | null,
      gamma: null as number | null,
      thetaPerDay: null as number | null,
      vegaPerPoint: null as number | null,
      complete: true,
      valuedPositions: positionGreeks.filter((row) => row.delta !== null).length,
    },
  );

  if (!currentGreeks.complete && positionGreeks.length > 0) {
    warnings.push(
      "Portfolio Greeks exclude contracts whose implied volatility could not be calibrated. The total is partial.",
    );
  }
  if (columns.some((column) => !column.incrementalComplete)) {
    warnings.push("One or more scenario P&L totals are partial because a contract could not be repriced.");
  }

  return {
    baseSpot: input.baseSpot,
    moves: input.moves,
    horizonDays: input.horizonDays,
    ivMode: input.ivMode,
    ivPoints: input.ivPoints,
    rate: input.rate,
    dividendYield: input.dividendYield,
    columns,
    rows,
    currentGreeks,
    positionGreeks,
    warnings,
    settlementAssumption: SETTLEMENT_ASSUMPTION,
    disclaimer: MODEL_DISCLAIMER,
    decay: withSideViews ? unchangedSpotDecay(input) : [],
    breakevens: findBreakevens(columns),
  };
}
