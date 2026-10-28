import { describe, expect, it } from "vitest";
import { readKiteAccount, readKiteConfig } from "@/lib/config";

const base = {
  KITE_API_KEY: "key-one",
  KITE_API_SECRET: "secret-one",
  KITE_REDIRECT_URL: "http://localhost:3000/api/kite/callback",
};

describe("kite account config", () => {
  it("reads the first app from KITE_API_KEY", () => {
    expect(readKiteConfig(base)?.apiKey).toBe("key-one");
    expect(readKiteAccount(2, base)).toBeNull();
  });

  it("reads the second app from KITE_API_KEY_2 and KITE_API_SECRET_2", () => {
    const second = readKiteAccount(2, {
      ...base,
      KITE_API_KEY_2: "key-two",
      KITE_API_SECRET_2: "secret-two",
    });
    expect(second).toEqual({
      apiKey: "key-two",
      apiSecret: "secret-two",
      redirectUrl: "http://localhost:3000/api/kite/callback",
    });
  });

  it("ignores the example placeholders", () => {
    expect(readKiteAccount(2, { ...base, KITE_API_KEY_2: "your_second_api_key", KITE_API_SECRET_2: "your_second_api_secret" })).toBeNull();
  });
});
