export interface PublicKiteError {
  httpStatus: number;
  code: "SESSION_EXPIRED" | "RATE_LIMIT" | "INVALID_CHECKSUM" | "BAD_REQUEST" | "KITE_ERROR";
  publicMessage: string;
}

function readError(error: unknown): { status?: number; errorType: string; message: string } {
  if (!error || typeof error !== "object") {
    return { errorType: "", message: "" };
  }
  const record = error as {
    status?: number;
    error_type?: string;
    message?: string;
    response?: { status?: number; data?: { error_type?: string; message?: string } };
  };
  return {
    status: record.response?.status ?? record.status,
    errorType: record.response?.data?.error_type ?? record.error_type ?? "",
    message: record.response?.data?.message ?? record.message ?? "",
  };
}

/** Maps a Kite or network failure to a message that cannot contain tokens. */
export function mapKiteError(error: unknown): PublicKiteError {
  const { status, errorType, message } = readError(error);
  if (status === 403 || errorType === "TokenException") {
    return {
      httpStatus: 401,
      code: "SESSION_EXPIRED",
      publicMessage: "The Zerodha session expired or was invalidated. Connect again.",
    };
  }
  if (status === 429 || errorType === "NetworkException" && /too many/i.test(message)) {
    return {
      httpStatus: 429,
      code: "RATE_LIMIT",
      publicMessage: "Kite rate limit reached. Quote calls are limited to about one per second. Wait and refresh.",
    };
  }
  if (/checksum/i.test(message) || /checksum/i.test(errorType)) {
    return {
      httpStatus: 400,
      code: "INVALID_CHECKSUM",
      publicMessage: "Zerodha rejected the login checksum.",
    };
  }
  if (status === 400 || errorType === "InputException") {
    return {
      httpStatus: 400,
      code: "BAD_REQUEST",
      publicMessage: "Zerodha rejected the request parameters.",
    };
  }
  return {
    httpStatus: 502,
    code: "KITE_ERROR",
    publicMessage: "The Zerodha request failed. No order was sent.",
  };
}

/** A failed place, modify, or cancel may already have reached Zerodha, so this does not claim otherwise. */
export function orderFailureMessage(error: unknown): { httpStatus: number; message: string } {
  const mapped = mapKiteError(error);
  if (mapped.code === "SESSION_EXPIRED" || mapped.code === "RATE_LIMIT") {
    return { httpStatus: mapped.httpStatus, message: mapped.publicMessage };
  }
  const { message } = readError(error);
  const clean = (typeof message === "string" ? message : "").replace(/\s+/g, " ").trim();
  if (clean && clean.length <= 400 && !/api_key|access_token|api_secret/i.test(clean)) {
    return { httpStatus: mapped.httpStatus === 502 ? 400 : mapped.httpStatus, message: clean.slice(0, 400) };
  }
  return {
    httpStatus: mapped.httpStatus,
    message: "Zerodha did not accept that order request. Check the order book before trying again.",
  };
}
