import { afterEach, describe, expect, it } from "vitest";
import {
  accountsForStatus,
  adoptLogin,
  clearMemorySessions,
  createMemorySession,
  getMemorySession,
  readCookieValue,
  requestDesk,
  setActiveAccount,
  removeActiveAccount,
  signSessionId,
  toPublicStatus,
  verifySessionCookie,
  SESSION_COOKIE,
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

  it("keeps the first login for quotes and switches the book to the account just added", () => {
    process.env.SESSION_SECRET = "test-secret";
    const now = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);
    const first = createMemorySession({
      accessToken: "token-a",
      userId: "AAAAAA",
      userName: "Alpha",
      userShortname: "Alpha",
      slot: 1,
      loginTime: now,
      now,
    });
    const opened = adoptLogin(null, first.session, now);
    expect("cookieValue" in opened).toBe(true);
    if (!("cookieValue" in opened)) return;
    const second = createMemorySession({
      accessToken: "token-b",
      userId: "BBBBBB",
      userName: "Beta",
      userShortname: "Beta",
      slot: 2,
      loginTime: now,
      now,
    });
    const added = adoptLogin(opened.cookieValue, second.session, now);
    expect("cookieValue" in added).toBe(true);
    if (!("cookieValue" in added)) return;
    const request = new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(added.cookieValue)}` } });
    const desk = requestDesk(request, now);
    expect(desk?.market.userId).toBe("AAAAAA");
    expect(desk?.active.userId).toBe("BBBBBB");
    const switched = setActiveAccount(request, first.session.id, now);
    expect(switched?.active.userId).toBe("AAAAAA");
    expect(switched?.market.userId).toBe("AAAAAA");
    setActiveAccount(request, second.session.id, now);
    const removed = removeActiveAccount(request, now);
    expect(removed.remaining?.active.userId).toBe("AAAAAA");
    expect(removed.remaining?.market.userId).toBe("AAAAAA");
  });

  it("keeps the same Zerodha user as user 1 and user 2", () => {
    process.env.SESSION_SECRET = "test-secret";
    const now = istWallTimeToUtc(2026, 9, 15, 10, 0, 0);
    const first = createMemorySession({
      accessToken: "token-a",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      slot: 1,
      loginTime: now,
      now,
    });
    const opened = adoptLogin(null, first.session, now);
    if (!("cookieValue" in opened)) throw new Error("expected a desk");
    const second = createMemorySession({
      accessToken: "token-b",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      slot: 2,
      loginTime: now,
      now,
    });
    const added = adoptLogin(opened.cookieValue, second.session, now);
    if (!("cookieValue" in added)) throw new Error("expected both users");
    const request = new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(added.cookieValue)}` } });
    const labels = accountsForStatus(requestDesk(request, now)).map((account) => `${account.number}:${account.userName}`);
    expect(labels).toEqual(["1:Trader", "2:Trader"]);
    const again = createMemorySession({
      accessToken: "token-a2",
      userId: "AB1234",
      userName: "Trader",
      userShortname: "Trader",
      slot: 1,
      loginTime: now,
      now,
    });
    const replaced = adoptLogin(added.cookieValue, again.session, now);
    if (!("cookieValue" in replaced)) throw new Error("expected user 1 to be replaced");
    const after = requestDesk(new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(replaced.cookieValue)}` } }), now);
    expect(after?.accounts.map((account) => account.slot).sort()).toEqual([1, 2]);
    expect(after?.accounts.find((account) => account.slot === 1)?.accessToken).toBe("token-a2");
    expect(after?.accounts.find((account) => account.slot === 2)?.accessToken).toBe("token-b");
  });

  it("rejects a tampered cookie", () => {
    const signed = signSessionId("session-id", "test-secret");
    expect(verifySessionCookie(`${signed}tamper`, "test-secret")).toBeNull();
  });
});
