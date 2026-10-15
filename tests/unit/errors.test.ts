import { describe, expect, it } from "vitest";
import { mapKiteError } from "@/lib/kite/errors";
import { isKiteTokenExpired, istWallTimeToUtc } from "@/lib/time";

describe("Kite errors and session expiry", () => {
  it("treats HTTP 403 as an expired session without echoing the token", () => {
    const mapped = mapKiteError({
      response: {
        status: 403,
        data: { error_type: "TokenException", message: "access_token=supersecret is invalid" },
      },
    });
    expect(mapped.code).toBe("SESSION_EXPIRED");
    expect(mapped.httpStatus).toBe(401);
    expect(mapped.publicMessage).not.toContain("supersecret");
  });

  it("maps rate limits and bad input", () => {
    expect(mapKiteError({ response: { status: 429, data: { message: "Too many requests" } } }).code).toBe("RATE_LIMIT");
    expect(mapKiteError({ response: { status: 400, data: { error_type: "InputException", message: "bad" } } }).code).toBe(
      "BAD_REQUEST",
    );
    expect(mapKiteError(new Error("socket hang up")).publicMessage).not.toContain("socket");
  });

  it("expires the access token at 06:00 IST on the next calendar day", () => {
    const login = istWallTimeToUtc(2026, 9, 15, 19, 0, 0);
    const before = istWallTimeToUtc(2026, 9, 16, 5, 59, 59);
    const atExpiry = istWallTimeToUtc(2026, 9, 16, 6, 0, 0);
    expect(isKiteTokenExpired(login, before)).toBe(false);
    expect(isKiteTokenExpired(login, atExpiry)).toBe(true);
  });
});
