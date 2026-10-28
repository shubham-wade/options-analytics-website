import { describe, expect, it } from "vitest";
import { createInstrumentCache } from "@/lib/kite/portfolio";
import { lookupContracts } from "@/lib/kite/lookup";
import type { KiteInstrument, KiteQuote } from "@/lib/kite/types";
import { istWallTimeToUtc } from "@/lib/time";

const now = istWallTimeToUtc(2026, 9, 15, 11, 0, 0);

function instrument(): KiteInstrument {
  return {
    instrument_token: 99,
    tradingsymbol: "NIFTY26DEC22000PE",
    name: "NIFTY",
    expiry: "2026-12-29",
    strike: 22000,
    lot_size: 65,
    instrument_type: "PE",
    exchange: "NFO",
  };
}

function quote(lastPrice: number): KiteQuote {
  return {
    last_price: lastPrice,
    timestamp: "2026-10-15 11:00:00",
  };
}

describe("manual contract lookup", () => {
  it("reads NIFTY spot, the instrument expiry and the live premium", async () => {
    const cache = createInstrumentCache();
    const lookup = await lookupContracts(
      {
        getPositions: async () => ({ net: [], day: [] }),
        getInstruments: async (exchange) => (exchange === "NFO" ? [instrument()] : []),
        getQuote: async () => ({
          "NSE:NIFTY 50": quote(25240),
          "NFO:NIFTY26DEC22000PE": quote(98.5),
        }),
      },
      ["nifty26dec22000pe"],
      cache,
      now,
    );
    expect(lookup.spot.price).toBe(25240);
    expect(lookup.contracts[0]?.price).toBe(98.5);
  });

  it("uses the NIFTY last price when the index quote also has a bid and ask", async () => {
    const cache = createInstrumentCache();
    const lookup = await lookupContracts(
      {
        getPositions: async () => ({ net: [], day: [] }),
        getInstruments: async () => [],
        getQuote: async () => ({
          "NSE:NIFTY 50": {
            ...quote(26110),
            ohlc: { close: 25980 },
            depth: { buy: [{ price: 24000, quantity: 1, orders: 1 }], sell: [{ price: 24010, quantity: 1, orders: 1 }] },
          },
        }),
      },
      [],
      cache,
      now,
    );
    expect(lookup.spot.price).toBe(26110);
    expect(lookup.spot.change).toBeCloseTo(130);
  });

  it("lists only NIFTY calls and puts, sorted by expiry and strike", async () => {
    const { listNiftyOptions } = await import("@/lib/kite/lookup");
    const listed = await listNiftyOptions(
      {
        getPositions: async () => ({ net: [], day: [] }),
        getInstruments: async (exchange) =>
          exchange === "NFO"
            ? [
                instrument(),
                { ...instrument(), tradingsymbol: "NIFTY26DEC22000CE", instrument_type: "CE" },
                { ...instrument(), tradingsymbol: "BANKNIFTY26DEC50000CE", name: "BANKNIFTY", instrument_type: "CE", strike: 50000 },
                { ...instrument(), tradingsymbol: "NIFTY26NOV24000PE", expiry: "2026-11-24", strike: 24000 },
              ]
            : [],
        getQuote: async () => ({}),
      },
      createInstrumentCache(),
    );
    expect(listed.map((contract) => contract.symbol)).toEqual([
      "NIFTY26NOV24000PE",
      "NIFTY26DEC22000CE",
      "NIFTY26DEC22000PE",
    ]);
  });
});
