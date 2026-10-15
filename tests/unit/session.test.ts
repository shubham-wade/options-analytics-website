import { afterEach, describe, expect, it } from "vitest";
import {
  clearMemorySessions,
  createMemorySession,
  getMemorySession,
  readCookieValue,
  signSessionId,
  toPublicStatus,
  verifySessionCookie,
} from "@/lib/session/store";
import { istWallTimeToUtc } from "@/lib/time";

describe("in-memory session", () => {
  afterEach(() => {
    clearMemorySessions();
  });

  it("round-trips a signed cookie that does not contain the access token", () => {
    process.env.SESSION_SECRET = "test-secret";
    const { session, cookieValue } = createMemorySession({
      accessToken: "access-token-value",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      loginTime: "2026-10-15 10:00:00",
      now: istWallTimeToUtc(2026, 9, 15, 10, 0, 0),
    });
    expect(cookieValue).not.toContain("access-token-value");
    expect(verifySessionCookie(cookieValue, "test-secret")).toBe(session.id);
    expect(verifySessionCookie(cookieValue, "other-secret")).toBeNull();
    const header = `theme=dark; nrl_sid=${encodeURIComponent(cookieValue)}`;
    expect(readCookieValue(header, "nrl_sid")).toBe(cookieValue);
  });

  it("drops an expired session and hides the access token from public status", () => {
    process.env.SESSION_SECRET = "test-secret";
    const { session } = createMemorySession({
      accessToken: "access-token-value",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      loginTime: "2026-10-15 10:00:00",
      now: istWallTimeToUtc(2026, 9, 15, 10, 0, 0),
    });
    const status = toPublicStatus(session, { configured: true, now: istWallTimeToUtc(2026, 9, 15, 11, 0, 0) });
    expect(status.connected).toBe(true);
    expect(status.userId).toBe("AB1234");
    expect(JSON.stringify(status)).not.toContain("access-token-value");
    expect(getMemorySession(session.id, istWallTimeToUtc(2026, 9, 16, 6, 0, 0))).toBeNull();
  });

  it("accepts the Date login_time returned by the Kite SDK", () => {
    process.env.SESSION_SECRET = "test-secret";
    const login = new Date("2026-10-15T04:30:00.000Z");
    const { session } = createMemorySession({
      accessToken: "access-token-value",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      loginTime: login,
      now: login,
    });
    expect(session.loginTime).toBe(login.toISOString());
    expect(session.expiresAt).toBe(istWallTimeToUtc(2026, 9, 16, 6, 0, 0).getTime());
  });

  it("rejects a tampered cookie", () => {
    const signed = signSessionId("session-id", "test-secret");
    expect(verifySessionCookie(`${signed}tamper`, "test-secret")).toBeNull();
  });
});
