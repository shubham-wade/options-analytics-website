import { describe, expect, it } from "vitest";
import { assessQuote } from "@/lib/kite/quotes";
import { istWallTimeToUtc } from "@/lib/time";

const duringSession = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);

describe("quote quality", () => {
  it("returns unavailable when the quote key is missing", () => {
    const quote = assessQuote(undefined, duringSession);
    expect(quote.quality).toBe("unavailable");
    expect(quote.price).toBeNull();
  });

  it("prefers a valid bid-ask midpoint over the last price", () => {
    const quote = assessQuote(
      {
        timestamp: "2026-10-15 09:59:50",
        last_trade_time: "2026-10-15 09:59:50",
        last_price: 100,
        depth: {
          buy: [{ price: 99, quantity: 75, orders: 2 }],
          sell: [{ price: 101, quantity: 75, orders: 1 }],
        },
      },
      duringSession,
    );
    expect(quote.source).toBe("mid");
    expect(quote.price).toBe(100);
    expect(quote.quality).toBe("live");
  });

  it("uses the last price and marks a stale packet", () => {
    const quote = assessQuote(
      {
        timestamp: "2026-10-15 09:50:00",
        last_trade_time: "2026-10-15 09:40:00",
        last_price: 42.5,
        depth: { buy: [{ price: 0 }], sell: [{ price: 0 }] },
      },
      duringSession,
    );
    expect(quote.source).toBe("ltp");
    expect(quote.price).toBe(42.5);
    expect(quote.quality).toBe("stale");
    expect(quote.warnings.join(" ")).toMatch(/last traded price/i);
  });

  it("uses the index last price when the quote has no depth", () => {
    const quote = assessQuote({ timestamp: "2026-10-15 09:59:55", last_price: 24050 }, duringSession);
    expect(quote.source).toBe("ltp");
    expect(quote.price).toBe(24050);
    expect(quote.warnings.join(" ")).not.toMatch(/bid and ask/i);
  });

  it("labels a weekend snapshot as market closed", () => {
    const quote = assessQuote(
      { timestamp: "2026-10-16 15:29:00", last_price: 24100 },
      istWallTimeToUtc(2026, 9, 18, 10, 0, 0),
    );
    expect(quote.quality).toBe("market-closed");
    expect(quote.price).toBe(24100);
  });
});
