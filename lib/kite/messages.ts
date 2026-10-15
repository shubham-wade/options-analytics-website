export type CallbackCode =
  | "missing_request_token"
  | "invalid_request_token"
  | "login_failed"
  | "invalid_checksum"
  | "exchange_failed"
  | "missing_config";

export function callbackErrorMessage(code: string | null): string | null {
  switch (code) {
    case "missing_request_token":
      return "Zerodha did not return a request token. Start the login again.";
    case "invalid_request_token":
      return "The request token from Zerodha was not valid.";
    case "login_failed":
      return "Zerodha login was cancelled or rejected.";
    case "invalid_checksum":
      return "Zerodha rejected the login checksum. Check that the API secret matches this app.";
    case "missing_config":
      return "Kite API credentials are not configured on the server. Copy .env.example to .env.local.";
    case "exchange_failed":
      return "The request token could not be exchanged. It may have expired. Connect again.";
    default:
      return code ? "Zerodha login failed." : null;
  }
}
