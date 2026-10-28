export interface KiteConfig {
  apiKey: string;
  apiSecret: string;
  redirectUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function readKiteConfig(env: NodeJS.ProcessEnv = process.env): KiteConfig | null {
  return readKiteAccount(1, env);
}

/** Slot 2 is the second Zerodha user's own Kite app. Personal apps cannot share one key. */
export function readKiteAccount(slot: 1 | 2, env: NodeJS.ProcessEnv = process.env): KiteConfig | null {
  const apiKey = (slot === 1 ? env.KITE_API_KEY : env.KITE_API_KEY_2)?.trim() ?? "";
  const apiSecret = (slot === 1 ? env.KITE_API_SECRET : env.KITE_API_SECRET_2)?.trim() ?? "";
  const redirectUrl = env.KITE_REDIRECT_URL?.trim() ?? "";
  if (!apiKey || !apiSecret || !redirectUrl) return null;
  if (apiKey === "your_api_key" || apiSecret === "your_api_secret" || apiKey === "your_second_api_key" || apiSecret === "your_second_api_secret") return null;
  return { apiKey, apiSecret, redirectUrl };
}

export function kiteApiKey(session: { apiKey?: string }, env: NodeJS.ProcessEnv = process.env): string {
  return session.apiKey?.trim() || readKiteConfig(env)?.apiKey || "";
}

export function requireKiteConfig(env: NodeJS.ProcessEnv = process.env): KiteConfig {
  const config = readKiteConfig(env);
  if (!config) {
    throw new ConfigError("Set KITE_API_KEY, KITE_API_SECRET and KITE_REDIRECT_URL in the server environment.");
  }
  try {
    const url = new URL(config.redirectUrl);
    if (!url.pathname.endsWith("/api/kite/callback")) {
      throw new ConfigError("KITE_REDIRECT_URL must end with /api/kite/callback.");
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("KITE_REDIRECT_URL is not a valid URL.");
  }
  return config;
}
