/**
 * Opt-in only. `npm test` does not run this file.
 * It never places, modifies or cancels orders.
 *
 *   KITE_SMOKE=1 KITE_API_KEY=... KITE_ACCESS_TOKEN=... npm run test:smoke
 */
import { describe, expect, it } from "vitest";

const enabled = process.env.KITE_SMOKE === "1" && process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN;

describe.skipIf(!enabled)("kite smoke", () => {
  it("reads the profile and does not call an order method", async () => {
    const { KiteConnect } = await import("kiteconnect");
    const client = new KiteConnect({
      api_key: process.env.KITE_API_KEY ?? "",
      access_token: process.env.KITE_ACCESS_TOKEN,
      debug: false,
    });
    const profile = await client.getProfile();
    expect(profile.user_id).toBeTruthy();
  });
});
