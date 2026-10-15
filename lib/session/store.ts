import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseKiteTimestamp, kiteTokenExpiresAt } from "@/lib/time";

export const SESSION_COOKIE = "nrl_sid";

export interface StoredSession {
  id: string;
  accessToken: string;
  userId: string;
  userName: string;
  userShortname: string;
  loginTime: string;
  expiresAt: number;
  createdAt: number;
}

export interface PublicSessionStatus {
  configured: boolean;
  connected: boolean;
  expired: boolean;
  userId: string | null;
  userName: string | null;
  expiresAt: string | null;
  loginTime: string | null;
  storage: "memory";
  sessionSecretConfigured: boolean;
}

interface SessionGlobal {
  sessions?: Map<string, StoredSession>;
  secret?: string;
}

const globalStore = globalThis as typeof globalThis & { __niftyRiskLab?: SessionGlobal };

function store(): Map<string, StoredSession> {
  if (!globalStore.__niftyRiskLab) globalStore.__niftyRiskLab = {};
  if (!globalStore.__niftyRiskLab.sessions) globalStore.__niftyRiskLab.sessions = new Map();
  return globalStore.__niftyRiskLab.sessions;
}

export function getSessionSecret(): { secret: string; configured: boolean } {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return { secret: fromEnv, configured: true };
  if (!globalStore.__niftyRiskLab) globalStore.__niftyRiskLab = {};
  if (!globalStore.__niftyRiskLab.secret) {
    globalStore.__niftyRiskLab.secret = randomBytes(32).toString("base64url");
  }
  return { secret: globalStore.__niftyRiskLab.secret, configured: false };
}

export function signSessionId(sessionId: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${mac}`;
}

export function verifySessionCookie(cookieValue: string, secret: string): string | null {
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;
  const sessionId = cookieValue.slice(0, separator);
  const mac = cookieValue.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(sessionId).digest("base64url");
  const actualBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return sessionId;
}

export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
}

export function createMemorySession(input: {
  accessToken: string;
  userId: string;
  userName: string;
  userShortname: string;
  loginTime: string | Date;
  now?: Date;
}): { session: StoredSession; cookieValue: string } {
  const now = input.now ?? new Date();
  const parsedLogin = parseKiteTimestamp(input.loginTime) ?? now;
  const session: StoredSession = {
    id: randomBytes(32).toString("base64url"),
    accessToken: input.accessToken,
    userId: input.userId,
    userName: input.userName,
    userShortname: input.userShortname,
    loginTime: parsedLogin.toISOString(),
    expiresAt: kiteTokenExpiresAt(parsedLogin).getTime(),
    createdAt: now.getTime(),
  };
  store().set(session.id, session);
  const { secret } = getSessionSecret();
  return { session, cookieValue: signSessionId(session.id, secret) };
}

export function getMemorySession(sessionId: string | null, now = new Date()): StoredSession | null {
  if (!sessionId) return null;
  const session = store().get(sessionId) ?? null;
  if (!session) return null;
  if (now.getTime() >= session.expiresAt) {
    store().delete(sessionId);
    return null;
  }
  return session;
}

export function destroyMemorySession(sessionId: string | null): void {
  if (sessionId) store().delete(sessionId);
}

export function sessionFromRequest(request: Request, now = new Date()): StoredSession | null {
  const { secret } = getSessionSecret();
  const raw = readCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!raw) return null;
  const sessionId = verifySessionCookie(raw, secret);
  return getMemorySession(sessionId, now);
}

export function toPublicStatus(
  session: StoredSession | null,
  options: { configured: boolean; expired?: boolean; now?: Date },
): PublicSessionStatus {
  const { configured: sessionSecretConfigured } = getSessionSecret();
  if (!session) {
    return {
      configured: options.configured,
      connected: false,
      expired: Boolean(options.expired),
      userId: null,
      userName: null,
      expiresAt: null,
      loginTime: null,
      storage: "memory",
      sessionSecretConfigured,
    };
  }
  const now = options.now ?? new Date();
  const expired = now.getTime() >= session.expiresAt;
  return {
    configured: options.configured,
    connected: !expired,
    expired,
    userId: session.userId,
    userName: session.userShortname || session.userName,
    expiresAt: new Date(session.expiresAt).toISOString(),
    loginTime: session.loginTime,
    storage: "memory",
    sessionSecretConfigured,
  };
}

/** Test helper. Not used by request handlers. */
export function clearMemorySessions(): void {
  store().clear();
}
