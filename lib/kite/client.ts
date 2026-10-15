import "server-only";
import { KiteConnect, type Connect } from "kiteconnect";
import type { KiteInstrument, KitePositionsResponse, KiteQuote, KiteSessionData } from "@/lib/kite/types";
import type { KiteReader } from "@/lib/kite/portfolio";

const MIN_QUOTE_GAP_MS = 1100;

interface RateState {
  nextQuoteAt?: number;
}

const globalRate = globalThis as typeof globalThis & { __niftyQuoteRate?: RateState };

async function waitForQuoteSlot(): Promise<void> {
  if (!globalRate.__niftyQuoteRate) globalRate.__niftyQuoteRate = {};
  const state = globalRate.__niftyQuoteRate;
  const now = Date.now();
  const earliest = state.nextQuoteAt ?? now;
  const wait = Math.max(0, earliest - now);
  state.nextQuoteAt = Math.max(earliest, now) + MIN_QUOTE_GAP_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

export function createLoginClient(apiKey: string): Connect {
  return new KiteConnect({ api_key: apiKey, debug: false });
}

export function createReadClient(apiKey: string, accessToken: string): Connect {
  return new KiteConnect({ api_key: apiKey, access_token: accessToken, debug: false });
}

export function asReader(client: Connect): KiteReader {
  return {
    async getPositions() {
      const response = await client.getPositions();
      return response as KitePositionsResponse;
    },
    async getInstruments(exchange) {
      const response = await client.getInstruments(
        exchange as Parameters<Connect["getInstruments"]>[0],
      );
      return response as KiteInstrument[];
    },
    async getQuote(instruments) {
      await waitForQuoteSlot();
      const response = await client.getQuote(instruments);
      return response as Record<string, KiteQuote | undefined>;
    },
  };
}

export async function generateKiteSession(
  client: Connect,
  requestToken: string,
  apiSecret: string,
): Promise<KiteSessionData> {
  const session = await client.generateSession(requestToken, apiSecret);
  return session as KiteSessionData;
}

export async function invalidateKiteSession(client: Connect): Promise<void> {
  await client.invalidateAccessToken();
}
