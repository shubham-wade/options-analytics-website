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
  const apiKey = env.KITE_API_KEY?.trim() ?? "";
  const apiSecret = env.KITE_API_SECRET?.trim() ?? "";
  const redirectUrl = env.KITE_REDIRECT_URL?.trim() ?? "";
  if (!apiKey || !apiSecret || !redirectUrl) return null;
  if (apiKey === "your_api_key" || apiSecret === "your_api_secret") return null;
  return { apiKey, apiSecret, redirectUrl };
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
