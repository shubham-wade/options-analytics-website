/**
 * Black–Scholes–Merton European option pricing.
 *
 * Assumptions, applied uniformly:
 * - The underlying follows geometric Brownian motion under a constant risk-free rate
 *   and a constant continuous dividend yield.
 * - Forward price is F = S * exp((r − q) * T). NIFTY futures are not implied.
 * - Time is measured in calendar years with an ACT/365 day count.
 * - Volatility is the annualised Black implied volatility (decimal, so 0.20 = 20%).
 * - Delta is ∂V/∂S. Gamma is ∂²V/∂S² per one underlying point.
 * - Theta is ∂V/∂t per calendar day (the annual formula divided by 365).
 * - Vega is ∂V/∂σ per one volatility percentage point (0.01 absolute).
 * - Interest rate and dividend yield are model inputs. Zerodha does not supply them.
 */

const YEAR_DAYS = 365;
const SQRT_2 = Math.SQRT2;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

export type OptionRight = "CE" | "PE";

export interface PricingInputs {
  spot: number;
  strike: number;
  timeYears: number;
  rate: number;
  dividendYield: number;
  volatility: number;
  right: OptionRight;
}

export interface OptionValue {
  premium: number;
  delta: number;
  gamma: number;
  /** Calendar-day theta, in premium points per day. */
  thetaPerDay: number;
  /** Premium change for a +1 volatility point move (for example 20% to 21%). */
  vegaPerPoint: number;
  intrinsic: number;
  timeValue: number;
  d1: number;
  d2: number;
}

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

/** Abramowitz–Stegun approximation 7.1.26. Maximum absolute error is about 1.5e-7. */
export function normalCdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / SQRT_2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) * INV_SQRT_2PI;
}

export function undiscountedIntrinsic(right: OptionRight, spot: number, strike: number): number {
  if (right === "CE") return Math.max(0, spot - strike);
  return Math.max(0, strike - spot);
}

function assertFiniteInputs(inputs: PricingInputs): void {
  const fields: Array<[string, number]> = [
    ["spot", inputs.spot],
    ["strike", inputs.strike],
    ["timeYears", inputs.timeYears],
    ["rate", inputs.rate],
    ["dividendYield", inputs.dividendYield],
    ["volatility", inputs.volatility],
  ];
  for (const [name, value] of fields) {
    if (!Number.isFinite(value)) {
      throw new PricingInputError(`${name} must be a finite number`);
    }
  }
  if (inputs.spot <= 0) throw new PricingInputError("spot must be positive");
  if (inputs.strike <= 0) throw new PricingInputError("strike must be positive");
  if (inputs.timeYears < 0) {
    throw new PricingInputError("time to expiry cannot be negative; use the expiry payoff");
  }
  if (inputs.volatility < 0) throw new PricingInputError("volatility cannot be negative");
  if (inputs.right !== "CE" && inputs.right !== "PE") {
    throw new PricingInputError("option right must be CE or PE");
  }
}

function zeroVolValue(inputs: PricingInputs): OptionValue {
  const { spot, strike, timeYears, rate, dividendYield, right } = inputs;
  const discountSpot = Math.exp(-dividendYield * timeYears);
  const discountStrike = Math.exp(-rate * timeYears);
  const forwardTerm = spot * discountSpot;
  const strikeTerm = strike * discountStrike;
  const premium = right === "CE" ? Math.max(0, forwardTerm - strikeTerm) : Math.max(0, strikeTerm - forwardTerm);
  const intrinsic = undiscountedIntrinsic(right, spot, strike);
  const inTheMoney = right === "CE" ? forwardTerm > strikeTerm : strikeTerm > forwardTerm;
  const delta = inTheMoney ? (right === "CE" ? discountSpot : -discountSpot) : 0;
  return {
    premium,
    delta,
    gamma: 0,
    thetaPerDay: 0,
    vegaPerPoint: 0,
    intrinsic,
    timeValue: premium - intrinsic,
    d1: inTheMoney ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
    d2: inTheMoney ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
  };
}

export function priceEuropean(inputs: PricingInputs): OptionValue {
  assertFiniteInputs(inputs);
  if (inputs.timeYears === 0 || inputs.volatility === 0) {
    if (inputs.timeYears === 0) {
      const intrinsic = undiscountedIntrinsic(inputs.right, inputs.spot, inputs.strike);
      const delta =
        inputs.right === "CE"
          ? inputs.spot > inputs.strike
            ? 1
            : inputs.spot < inputs.strike
              ? 0
              : 0.5
          : inputs.spot < inputs.strike
            ? -1
            : inputs.spot > inputs.strike
              ? 0
              : -0.5;
      return {
        premium: intrinsic,
        delta,
        gamma: 0,
        thetaPerDay: 0,
        vegaPerPoint: 0,
        intrinsic,
        timeValue: 0,
        d1: 0,
        d2: 0,
      };
    }
    return zeroVolValue(inputs);
  }

  const { spot, strike, timeYears, rate, dividendYield, volatility, right } = inputs;
  const sqrtT = Math.sqrt(timeYears);
  const d1 =
    (Math.log(spot / strike) + (rate - dividendYield + 0.5 * volatility * volatility) * timeYears) /
    (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discountSpot = Math.exp(-dividendYield * timeYears);
  const discountStrike = Math.exp(-rate * timeYears);
  const pdf = normalPdf(d1);
  const nd1 = normalCdf(d1);
  const nd2 = normalCdf(d2);

  const call = spot * discountSpot * nd1 - strike * discountStrike * nd2;
  const put = strike * discountStrike * normalCdf(-d2) - spot * discountSpot * normalCdf(-d1);
  const premium = right === "CE" ? call : put;

  const delta = right === "CE" ? discountSpot * nd1 : discountSpot * (nd1 - 1);
  const gamma = (discountSpot * pdf) / (spot * volatility * sqrtT);
  const vegaPerUnitVol = spot * discountSpot * pdf * sqrtT;
  const annualTheta =
    right === "CE"
      ? -((spot * discountSpot * pdf * volatility) / (2 * sqrtT)) -
        rate * strike * discountStrike * nd2 +
        dividendYield * spot * discountSpot * nd1
      : -((spot * discountSpot * pdf * volatility) / (2 * sqrtT)) +
        rate * strike * discountStrike * normalCdf(-d2) -
        dividendYield * spot * discountSpot * normalCdf(-d1);

  const intrinsic = undiscountedIntrinsic(right, spot, strike);
  return {
    premium,
    delta,
    gamma,
    thetaPerDay: annualTheta / YEAR_DAYS,
    vegaPerPoint: vegaPerUnitVol * 0.01,
    intrinsic,
    timeValue: premium - intrinsic,
    d1,
    d2,
  };
}

export interface ImpliedVolResult {
  volatility: number | null;
  status: "calibrated" | "below-bounds" | "above-bounds" | "invalid-price" | "no-time";
  lowerBound: number;
  upperBound: number;
}

export function optionPriceBounds(inputs: Omit<PricingInputs, "volatility" | "right"> & { right: OptionRight }): {
  lower: number;
  upper: number;
} {
  const { spot, strike, timeYears, rate, dividendYield, right } = inputs;
  const discountSpot = Math.exp(-dividendYield * timeYears);
  const discountStrike = Math.exp(-rate * timeYears);
  if (right === "CE") {
    return {
      lower: Math.max(0, spot * discountSpot - strike * discountStrike),
      upper: spot * discountSpot,
    };
  }
  return {
    lower: Math.max(0, strike * discountStrike - spot * discountSpot),
    upper: strike * discountStrike,
  };
}

/**
 * Calibrate Black implied volatility from an observed premium.
 * Returns null rather than a fabricated volatility when the premium is outside
 * model bounds or time has already run out.
 */
export function implyVolatility(
  inputs: Omit<PricingInputs, "volatility">,
  marketPremium: number,
): ImpliedVolResult {
  if (!Number.isFinite(marketPremium) || marketPremium < 0) {
    return { volatility: null, status: "invalid-price", lowerBound: 0, upperBound: 0 };
  }
  if (inputs.timeYears <= 0) {
    return { volatility: null, status: "no-time", lowerBound: 0, upperBound: 0 };
  }
  const bounds = optionPriceBounds(inputs);
  const boundTolerance = 0.05;
  if (marketPremium < bounds.lower - boundTolerance) {
    return { volatility: null, status: "below-bounds", lowerBound: bounds.lower, upperBound: bounds.upper };
  }
  if (marketPremium > bounds.upper + boundTolerance) {
    return { volatility: null, status: "above-bounds", lowerBound: bounds.lower, upperBound: bounds.upper };
  }

  const priceTolerance = Math.max(1e-6, marketPremium * 1e-8);

  let low = 1e-4;
  let high = 5;
  const priceAt = (volatility: number) =>
    priceEuropean({ ...inputs, volatility }).premium;

  let highPrice = priceAt(high);
  while (highPrice < marketPremium && high < 20) {
    high *= 1.5;
    highPrice = priceAt(high);
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = 0.5 * (low + high);
    const price = priceAt(mid);
    if (Math.abs(price - marketPremium) < priceTolerance) {
      return { volatility: mid, status: "calibrated", lowerBound: bounds.lower, upperBound: bounds.upper };
    }
    if (price > marketPremium) high = mid;
    else low = mid;
  }

  return {
    volatility: 0.5 * (low + high),
    status: "calibrated",
    lowerBound: bounds.lower,
    upperBound: bounds.upper,
  };
}
