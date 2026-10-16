/**
 * Position P&L uses the signed net quantity already expressed in option units.
 *
 * Long quantity q > 0:  P&L = q × multiplier × (exit − entry)
 * Short quantity q < 0: P&L = q × multiplier × (exit − entry)
 *   which is the same as |q| × multiplier × (entry − exit).
 *
 * The lot size is not applied again. Kite's NFO `quantity` is already in units
 * (lots × lot size) and `multiplier` is the contract multiplier (1 for NIFTY options).
 */

export interface PnlInputs {
  /** Signed net quantity. Positive is long, negative is short. */
  quantity: number;
  multiplier: number;
  entryPremium: number | null;
  exitPremium: number | null;
  currentPremium: number | null;
}

export interface PnlResult {
  tradePnl: number | null;
  incrementalPnl: number | null;
  tradeUnavailableReason: string | null;
  incrementalUnavailableReason: string | null;
}

export function positionPnl(inputs: PnlInputs): PnlResult {
  const scale = inputs.quantity * inputs.multiplier;
  if (!Number.isFinite(inputs.quantity) || !Number.isFinite(inputs.multiplier)) {
    return {
      tradePnl: null,
      incrementalPnl: null,
      tradeUnavailableReason: "Quantity or multiplier is not a finite number.",
      incrementalUnavailableReason: "Quantity or multiplier is not a finite number.",
    };
  }

  const trade =
    inputs.entryPremium === null || !Number.isFinite(inputs.entryPremium) || inputs.entryPremium <= 0
      ? null
      : inputs.exitPremium === null || !Number.isFinite(inputs.exitPremium)
        ? null
        : scale * (inputs.exitPremium - inputs.entryPremium);

  const incremental =
    inputs.currentPremium === null || !Number.isFinite(inputs.currentPremium)
      ? null
      : inputs.exitPremium === null || !Number.isFinite(inputs.exitPremium)
        ? null
        : scale * (inputs.exitPremium - inputs.currentPremium);

  return {
    tradePnl: trade,
    incrementalPnl: incremental,
    tradeUnavailableReason:
      trade === null
        ? "Entry premium is missing or not positive, so trade P&L is not calculated."
        : null,
    incrementalUnavailableReason:
      incremental === null ? "Current market premium is missing, so incremental P&L is not calculated." : null,
  };
}

/**
 * Day's P&L for one Kite net position.
 *
 * Cash from today's sells and buys, plus the open quantity marked at the last
 * traded price, minus the overnight quantity marked at the previous close.
 * A round trip that is flat by the close is included. Lot size is not applied
 * again: quantity is already in option units.
 */
export function kiteDayPnl(input: {
  quantity: number;
  overnightQuantity: number;
  multiplier: number;
  closePrice: number | null;
  dayBuyValue: number | null;
  daySellValue: number | null;
  markPrice: number | null;
}): number | null {
  const { quantity, overnightQuantity, multiplier, closePrice, dayBuyValue, daySellValue, markPrice } = input;
  if (!Number.isFinite(quantity) || !Number.isFinite(overnightQuantity) || !Number.isFinite(multiplier) || multiplier <= 0) {
    return null;
  }
  if (dayBuyValue === null || daySellValue === null || !Number.isFinite(dayBuyValue) || !Number.isFinite(daySellValue)) {
    return null;
  }
  if (quantity !== 0 && (markPrice === null || !Number.isFinite(markPrice) || markPrice <= 0)) return null;
  if (overnightQuantity !== 0 && (closePrice === null || !Number.isFinite(closePrice) || closePrice <= 0)) return null;
  const marked = quantity === 0 ? 0 : markPrice! * quantity * multiplier;
  const previous = overnightQuantity === 0 ? 0 : closePrice! * overnightQuantity * multiplier;
  return daySellValue - dayBuyValue + marked - previous;
}

/** Change from the previous close for a quantity held as typed. No intraday round-trip is known. */
export function markedFromClosePnl(quantity: number, current: number | null, previousClose: number | null): number | null {
  if (!Number.isFinite(quantity) || quantity === 0) return null;
  if (current === null || previousClose === null || !Number.isFinite(current) || !Number.isFinite(previousClose)) return null;
  if (current <= 0 || previousClose <= 0) return null;
  return quantity * (current - previousClose);
}

export function sumNullable(values: Array<number | null>): { total: number | null; complete: boolean } {
  if (values.length === 0) return { total: 0, complete: true };
  let total = 0;
  let complete = true;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      complete = false;
      continue;
    }
    total += value;
  }
  if (!complete && values.every((value) => value === null || !Number.isFinite(value))) {
    return { total: null, complete: false };
  }
  return { total, complete };
}
