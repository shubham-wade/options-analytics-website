import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exchangeRequestToken, kiteChecksum, validateKiteCallback } from "@/lib/kite/auth";

describe("Kite callback validation", () => {
  it("accepts a successful request token", () => {
    expect(validateKiteCallback({ request_token: "abcdefghij", status: "success" })).toEqual({
      ok: true,
      requestToken: "abcdefghij",
    });
  });

  it("rejects a missing request token", () => {
    expect(validateKiteCallback({ status: "success" })).toEqual({ ok: false, code: "missing_request_token" });
  });

  it("rejects a failed Zerodha login", () => {
    expect(validateKiteCallback({ status: "error", request_token: "abcdefghij" })).toEqual({
      ok: false,
      code: "login_failed",
    });
  });

  it("rejects a malformed request token before any secret is used", () => {
    expect(validateKiteCallback({ request_token: "bad token", status: "success" })).toEqual({
      ok: false,
      code: "invalid_request_token",
    });
  });

  it("builds the documented checksum", () => {
    const checksum = kiteChecksum("key", "token123", "secret");
    expect(checksum).toBe(createHash("sha256").update("keytoken123secret").digest("hex"));
  });

  it("maps an invalid checksum from the token exchange", async () => {
    const result = await exchangeRequestToken(
      {
        generateSession: async () => {
          throw Object.assign(new Error("Invalid checksum"), { error_type: "TokenException" });
        },
      },
      "token1234",
      "secret",
    );
    expect(result).toEqual({ ok: false, code: "invalid_checksum" });
  });

  it("does not exchange when the request token is missing", async () => {
    let called = false;
    const result = await exchangeRequestToken(
      {
        generateSession: async () => {
          called = true;
          return { access_token: "should-not-exist" };
        },
      },
      "   ",
      "secret",
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("rejects an exchange that returns no access token", async () => {
    const result = await exchangeRequestToken(
      { generateSession: async () => ({ user_id: "AB1234" }) },
      "token1234",
      "secret",
    );
    expect(result).toEqual({ ok: false, code: "exchange_failed" });
  });
});
