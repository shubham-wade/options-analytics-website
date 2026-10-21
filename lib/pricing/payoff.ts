import type { OptionRight } from "@/lib/pricing/black-scholes";

export interface PayoffLeg {
  right: OptionRight;
  strike: number;
  /** Signed. Positive is long, negative is short. */
  quantity: number;
  multiplier: number;
  entryPremium: number | null;
  /** Live premium. Used for the current P&L point, not the expiry curve. */
  marketPremium?: number | null;
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

export interface SignedPayoffPoint {
  spot: number;
  pnl: number;
  loss: number | null;
  gain: number | null;
  crossing: boolean;
}

export interface PayoffExtreme {
  kind: "finite" | "unlimited";
  pnl: number | null;
  /** Spot where a finite extreme is reached, when that spot is unique. */
  spot: number | null;
}

export interface PayoffProfile {
  points: PayoffPoint[];
  maxProfit: PayoffExtreme;
  maxLoss: PayoffExtreme;
  /** Contracts left out because the average price or contract terms are missing. */
  omitted: number;
  markSpot: number | null;
  /** Current NIFTY on the horizontal axis, and the open book's live P&L on the vertical axis. */
  now: PayoffPoint | null;
}

interface UsableLeg extends PayoffLeg {
  entryPremium: number;
}

export function expiryPayoff(legs: PayoffLeg[], markSpot: number | null): PayoffProfile | null {
  const usable: UsableLeg[] = [];
  let omitted = 0;
  for (const leg of legs) {
    if (usableLeg(leg)) usable.push(leg);
    else if (leg.quantity !== 0) omitted += 1;
  }
  if (usable.length === 0) return omitted > 0 ? emptyProfile(omitted) : null;

  const strikes = [...new Set(usable.map((leg) => leg.strike))].sort((left, right) => left - right);
  const netCall = usable.reduce((sum, leg) => sum + (leg.right === "CE" ? leg.quantity * leg.multiplier : 0), 0);
  const knots = [0, ...strikes].map((spot) => ({ spot, pnl: pnlAt(usable, spot) }));
  const highest = extreme(knots, "max");
  const lowest = extreme(knots, "min");
  const maxProfit: PayoffExtreme = netCall > 0 ? unlimited() : { kind: "finite", pnl: highest.pnl, spot: highest.spot };
  const maxLoss: PayoffExtreme = netCall < 0 ? unlimited() : { kind: "finite", pnl: lowest.pnl, spot: lowest.spot };

  const span = Math.max(strikes[strikes.length - 1] - strikes[0], 400);
  const pad = Math.max(200, span * 0.25);
  const mark = markSpot != null && Number.isFinite(markSpot) && markSpot > 0 ? markSpot : null;
  let low = Math.max(0, strikes[0] - pad);
  let high = strikes[strikes.length - 1] + pad * (netCall === 0 ? 1 : 1.6);
  if (mark != null) {
    low = Math.min(low, Math.max(0, mark - pad));
    high = Math.max(high, mark + pad);
  }
  const spots = [low, ...strikes.filter((strike) => strike > low && strike < high), high];
  if (mark != null && mark > low && mark < high) spots.push(mark);
  spots.sort((left, right) => left - right);

  const points: PayoffPoint[] = [];
  for (const spot of spots) {
    const last = points[points.length - 1];
    if (last && Math.abs(last.spot - spot) < 1e-6) continue;
    points.push({ spot, pnl: pnlAt(usable, spot) });
  }

  return {
    points,
    maxProfit,
    maxLoss,
    omitted,
    markSpot: mark,
    now: mark == null ? null : currentPoint(usable, mark),
  };
}

function currentPoint(legs: UsableLeg[], spot: number): PayoffPoint | null {
  let pnl = 0;
  for (const leg of legs) {
    const market = leg.marketPremium;
    if (market == null || !Number.isFinite(market) || market < 0) return null;
    pnl += leg.quantity * leg.multiplier * (market - leg.entryPremium);
  }
  return { spot, pnl };
}

/** Splits the expiry curve so the loss can be drawn red and the profit green, including a zero crossing. */
export function signedPayoffSeries(points: PayoffPoint[]): SignedPayoffPoint[] {
  const rows: SignedPayoffPoint[] = points.map((point) => ({
    spot: point.spot,
    pnl: point.pnl,
    crossing: false,
    ...signedPnl(point.pnl),
  }));
  const crossings: SignedPayoffPoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (!left || !right || left.pnl === 0 || right.pnl === 0) continue;
    if ((left.pnl < 0 && right.pnl > 0) || (left.pnl > 0 && right.pnl < 0)) {
      const share = Math.abs(left.pnl) / (Math.abs(left.pnl) + Math.abs(right.pnl));
      crossings.push({
        spot: left.spot + (right.spot - left.spot) * share,
        pnl: 0,
        loss: 0,
        gain: 0,
        crossing: true,
      });
    }
  }
  return [...rows, ...crossings].sort((left, right) => left.spot - right.spot);
}

function signedPnl(pnl: number): { loss: number | null; gain: number | null } {
  if (pnl < 0) return { loss: pnl, gain: null };
  if (pnl > 0) return { loss: null, gain: pnl };
  return { loss: 0, gain: 0 };
}

function emptyProfile(omitted: number): PayoffProfile {
  return {
    points: [],
    maxProfit: { kind: "finite", pnl: null, spot: null },
    maxLoss: { kind: "finite", pnl: null, spot: null },
    omitted,
    markSpot: null,
    now: null,
  };
}

function unlimited(): PayoffExtreme {
  return { kind: "unlimited", pnl: null, spot: null };
}

function usableLeg(leg: PayoffLeg): leg is UsableLeg {
  return (
    (leg.right === "CE" || leg.right === "PE")
    && Number.isFinite(leg.strike)
    && leg.strike > 0
    && Number.isFinite(leg.quantity)
    && leg.quantity !== 0
    && Number.isFinite(leg.multiplier)
    && leg.multiplier > 0
    && leg.entryPremium != null
    && Number.isFinite(leg.entryPremium)
    && leg.entryPremium > 0
  );
}

function pnlAt(legs: UsableLeg[], spot: number): number {
  let total = 0;
  for (const leg of legs) {
    const intrinsic = leg.right === "CE" ? Math.max(0, spot - leg.strike) : Math.max(0, leg.strike - spot);
    total += leg.quantity * leg.multiplier * (intrinsic - leg.entryPremium);
  }
  return total;
}

function extreme(points: PayoffPoint[], pick: "max" | "min"): { pnl: number; spot: number | null } {
  let pnl = pick === "max" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const point of points) pnl = pick === "max" ? Math.max(pnl, point.pnl) : Math.min(pnl, point.pnl);
  const spots = points.filter((point) => Math.abs(point.pnl - pnl) < 0.01).map((point) => point.spot);
  return { pnl, spot: spots.length === 1 ? spots[0] : null };
}
