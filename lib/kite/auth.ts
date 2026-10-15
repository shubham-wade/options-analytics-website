import { createHash } from "node:crypto";
import type { CallbackCode } from "@/lib/kite/messages";

export type { CallbackCode } from "@/lib/kite/messages";

export interface CallbackQuery {
  request_token?: string | null;
  status?: string | null;
  action?: string | null;
}

export type CallbackValidation =
  | { ok: true; requestToken: string }
  | { ok: false; code: CallbackCode };

const REQUEST_TOKEN_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * Zerodha redirects with `request_token` and `status=success`.
 * A missing token, a failed login, or a malformed token is rejected
 * before any secret is used.
 */
export function validateKiteCallback(input: CallbackQuery): CallbackValidation {
  const status = (input.status ?? "").trim().toLowerCase();
  if (status && status !== "success") {
    return { ok: false, code: "login_failed" };
  }
  const requestToken = input.request_token?.trim() ?? "";
  if (!requestToken) return { ok: false, code: "missing_request_token" };
  if (!REQUEST_TOKEN_PATTERN.test(requestToken) || requestToken.length < 8 || requestToken.length > 128) {
    return { ok: false, code: "invalid_request_token" };
  }
  return { ok: true, requestToken };
}

/** SHA-256 of api_key + request_token + api_secret, which is what Kite calls the checksum. */
export function kiteChecksum(apiKey: string, requestToken: string, apiSecret: string): string {
  return createHash("sha256").update(`${apiKey}${requestToken}${apiSecret}`).digest("hex");
}

export interface SessionExchangeClient {
  generateSession: (
    requestToken: string,
    apiSecret: string,
  ) => Promise<{
    access_token?: string;
    user_id?: string;
    user_name?: string;
    user_shortname?: string;
    login_time?: string | Date;
  }>;
}

export type ExchangeResult =
  | {
      ok: true;
      accessToken: string;
      userId: string;
      userName: string;
      userShortname: string;
      loginTime: string;
    }
  | { ok: false; code: CallbackCode };

export async function exchangeRequestToken(
  client: SessionExchangeClient,
  requestToken: string,
  apiSecret: string,
): Promise<ExchangeResult> {
  const validation = validateKiteCallback({ request_token: requestToken, status: "success" });
  if (!validation.ok) return validation;
  try {
    const session = await client.generateSession(validation.requestToken, apiSecret);
    if (!session?.access_token || !session.user_id) {
      return { ok: false, code: "exchange_failed" };
    }
    return {
      ok: true,
      accessToken: session.access_token,
      userId: session.user_id,
      userName: session.user_name ?? session.user_id,
      userShortname: session.user_shortname ?? session.user_name ?? session.user_id,
      loginTime:
        session.login_time instanceof Date
          ? session.login_time.toISOString()
          : typeof session.login_time === "string"
            ? session.login_time
            : "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errorType =
      typeof error === "object" && error && "error_type" in error ? String((error as { error_type?: string }).error_type) : "";
    if (/checksum/i.test(message) || /checksum/i.test(errorType)) {
      return { ok: false, code: "invalid_checksum" };
    }
    return { ok: false, code: "exchange_failed" };
  }
}

