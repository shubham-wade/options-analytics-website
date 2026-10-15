import { describe, expect, it } from "vitest";
import { extractNetPositions, parseNiftyOptionSymbol, selectNiftyOptionPositions } from "@/lib/kite/positions";
import type { KiteInstrument, KiteNetPosition } from "@/lib/kite/types";

function position(overrides: Partial<KiteNetPosition> = {}): KiteNetPosition {
  return {
    tradingsymbol: "NIFTY25OCT24200CE",
    exchange: "NFO",
    instrument_token: 123456,
    product: "NRML",
    quantity: 75,
    overnight_quantity: 75,
    multiplier: 1,
    average_price: 120.5,
    close_price: 110,
    last_price: 130,
    value: 9750,
    pnl: 712.5,
    m2m: 1500,
    unrealised: 500,
    realised: 212.5,
    buy_quantity: 75,
    buy_price: 120.5,
    buy_value: 9037.5,
    buy_m2m: 9037.5,
    day_buy_quantity: 0,
    day_buy_price: 0,
    day_buy_value: 0,
    sell_quantity: 0,
    sell_price: 0,
    sell_value: 0,
    sell_m2m: 0,
    day_sell_quantity: 0,
    day_sell_price: 0,
    day_sell_value: 0,
    ...overrides,
  };
}

function instrument(overrides: Partial<KiteInstrument> = {}): KiteInstrument {
  return {
    instrument_token: "123456",
    tradingsymbol: "NIFTY25OCT24200CE",
    name: "NIFTY",
    expiry: new Date("2026-10-28"),
    strike: 24200,
    lot_size: 75,
    instrument_type: "CE",
    segment: "NFO-OPT",
    exchange: "NFO",
    ...overrides,
  };
}

describe("net position mapping", () => {
  const master = new Map([["NFO:NIFTY25OCT24200CE", instrument()]]);

  it("uses the net array and ignores day-only activity", () => {
    const dayOnly = position({ tradingsymbol: "NIFTY25OCT24000PE", quantity: -75 });
    const net = extractNetPositions({ net: [position()], day: [dayOnly] });
    const selected = selectNiftyOptionPositions(net, master, { includeFlat: false });
    expect(selected.positions).toHaveLength(1);
    expect(selected.positions[0]?.tradingSymbol).toBe("NIFTY25OCT24200CE");
  });

  it("keeps the signed net quantity instead of inferring a side from buy and sell counts", () => {
    const short = position({
      quantity: -150,
      buy_quantity: 75,
      sell_quantity: 225,
      average_price: 88,
    });
    const selected = selectNiftyOptionPositions([short], master, { includeFlat: false });
    expect(selected.positions[0]?.quantity).toBe(-150);
    expect(selected.positions[0]?.side).toBe("short");
    expect(selected.positions[0]?.multiplier).toBe(1);
    expect(selected.positions[0]?.lotSize).toBe(75);
  });

  it("excludes zero-quantity contracts unless requested and counts them", () => {
    const flat = position({ quantity: 0, average_price: 0 });
    const hidden = selectNiftyOptionPositions([flat, position()], master, { includeFlat: false });
    expect(hidden.flatCount).toBe(1);
    expect(hidden.positions).toHaveLength(1);
    const shown = selectNiftyOptionPositions([flat], master, { includeFlat: true });
    expect(shown.positions).toHaveLength(1);
    expect(shown.positions[0]?.quantity).toBe(0);
  });

  it("rejects non-NIFTY contracts and keeps both calls and puts", () => {
    const put = instrument({
      tradingsymbol: "NIFTY25O1424100PE",
      instrument_type: "PE",
      strike: 24100,
    });
    const map = new Map<string, KiteInstrument>([
      ["NFO:NIFTY25OCT24200CE", instrument()],
      ["NFO:NIFTY25O1424100PE", put],
      ["NFO:BANKNIFTY25OCT52000CE", instrument({ tradingsymbol: "BANKNIFTY25OCT52000CE", name: "BANKNIFTY" })],
    ]);
    const selected = selectNiftyOptionPositions(
      [
        position(),
        position({ tradingsymbol: "NIFTY25O1424100PE", instrument_token: 2, quantity: -75 }),
        position({ tradingsymbol: "BANKNIFTY25OCT52000CE", instrument_token: 3 }),
        position({ tradingsymbol: "INFY", exchange: "NSE", instrument_token: 4 }),
        position({ tradingsymbol: "NIFTY25OCTFUT", instrument_token: 5 }),
      ],
      map,
      { includeFlat: false },
    );
    expect(selected.positions.map((row) => row.optionType)).toEqual(["CE", "PE"]);
  });

  it("does not treat a missing average price as zero", () => {
    const selected = selectNiftyOptionPositions([position({ average_price: 0 })], master, { includeFlat: false });
    expect(selected.positions[0]?.averagePrice).toBeNull();
    expect(selected.positions[0]?.warnings.join(" ")).toMatch(/Average price/);
  });

  it("parses a weekly symbol without inventing a monthly expiry day", () => {
    expect(parseNiftyOptionSymbol("NIFTY25O1424200CE")).toMatchObject({
      optionType: "CE",
      strike: 24200,
      expiryPrecision: "day",
    });
    expect(parseNiftyOptionSymbol("NIFTY25OCT24200CE")?.expiry).toBeNull();
    expect(parseNiftyOptionSymbol("BANKNIFTY25OCT52000CE")).toBeNull();
  });
});
