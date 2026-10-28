import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseKiteTimestamp, kiteTokenExpiresAt } from "@/lib/time";

export const SESSION_COOKIE = "nrl_sid";
/** Which Kite app the in-progress login belongs to. "2" uses KITE_API_KEY_2. */
export const KITE_LOGIN_SLOT_COOKIE = "nrl_kite_slot";

export interface StoredSession {
  id: string;
  accessToken: string;
  userId: string;
  userName: string;
  userShortname: string;
  loginTime: string;
  expiresAt: number;
  createdAt: number;
  /** Kite app that issued this access token. Empty uses KITE_API_KEY. */
  apiKey?: string;
  /** 1 is the first Kite app, 2 is KITE_API_KEY_2. Same Zerodha user can sit in both. */
  slot: 1 | 2;
}

export interface PublicAccount {
  id: string;
  userId: string;
  userName: string;
  /** Stable label so two logins of the same Zerodha user stay distinct. */
  number: 1 | 2;
  active: boolean;
  /** This login fetches NIFTY, India VIX, and option quotes for every book. */
  market: boolean;
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
  accounts: PublicAccount[];
  /** KITE_API_KEY_2 and KITE_API_SECRET_2 are set, so a second login can be added. */
  secondAccountConfigured: boolean;
}

interface Desk {
  id: string;
  accountIds: string[];
  activeId: string;
  marketId: string;
}

interface SessionGlobal {
  sessions?: Map<string, StoredSession>;
  desks?: Map<string, Desk>;
  secret?: string;
}

const globalStore = globalThis as typeof globalThis & { __niftyRiskLab?: SessionGlobal };

const MAX_ACCOUNTS = 2;

function store(): Map<string, StoredSession> {
  if (!globalStore.__niftyRiskLab) globalStore.__niftyRiskLab = {};
  if (!globalStore.__niftyRiskLab.sessions) globalStore.__niftyRiskLab.sessions = new Map();
  return globalStore.__niftyRiskLab.sessions;
}

function desks(): Map<string, Desk> {
  if (!globalStore.__niftyRiskLab) globalStore.__niftyRiskLab = {};
  if (!globalStore.__niftyRiskLab.desks) globalStore.__niftyRiskLab.desks = new Map();
  return globalStore.__niftyRiskLab.desks;
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
  apiKey?: string;
  slot?: 1 | 2;
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
    apiKey: input.apiKey?.trim() || undefined,
    slot: input.slot === 2 ? 2 : 1,
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

export interface ResolvedDesk {
  desk: Desk;
  active: StoredSession;
  market: StoredSession;
  accounts: StoredSession[];
}

/** Adds a Zerodha login beside the ones already on this browser. The first login keeps the shared quotes. */
export function adoptLogin(cookieValue: string | null, session: StoredSession, now = new Date()): { cookieValue: string } | { error: "too_many_accounts" } {
  const { secret } = getSessionSecret();
  const currentId = cookieValue ? verifySessionCookie(cookieValue, secret) : null;
  const existing = currentId ? savedOrLegacyDesk(currentId, now) : null;
  if (existing && existing.accountIds.length >= MAX_ACCOUNTS && !existing.accountIds.some((id) => accountSlot(store().get(id)) === session.slot)) {
    destroyMemorySession(session.id);
    return { error: "too_many_accounts" };
  }
  const desk = existing ?? { id: randomBytes(32).toString("base64url"), accountIds: [], activeId: session.id, marketId: session.id };
  const next = insertAccount(desk, session);
  desks().set(next.id, next);
  return { cookieValue: signSessionId(next.id, secret) };
}

export function requestDesk(request: Request, now = new Date()): ResolvedDesk | null {
  const { secret } = getSessionSecret();
  const raw = readCookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!raw) return null;
  const id = verifySessionCookie(raw, secret);
  if (!id) return null;
  const desk = savedOrLegacyDesk(id, now);
  if (!desk) return null;
  const accounts = desk.accountIds.flatMap((accountId) => {
    const session = getMemorySession(accountId, now);
    return session ? [session] : [];
  });
  if (accounts.length === 0) {
    desks().delete(desk.id);
    return null;
  }
  const active = accounts.find((account) => account.id === desk.activeId) ?? accounts[0];
  const market = accounts.find((account) => account.id === desk.marketId) ?? accounts[0];
  const pruned: Desk = { ...desk, accountIds: accounts.map((account) => account.id), activeId: active.id, marketId: market.id };
  if (desks().has(desk.id)) desks().set(desk.id, pruned);
  return { desk: pruned, active, market, accounts };
}

export function sessionFromRequest(request: Request, now = new Date()): StoredSession | null {
  return requestDesk(request, now)?.active ?? null;
}

export function marketSessionFromRequest(request: Request, now = new Date()): StoredSession | null {
  return requestDesk(request, now)?.market ?? null;
}

export function setActiveAccount(request: Request, accountId: string, now = new Date()): ResolvedDesk | null {
  const resolved = requestDesk(request, now);
  if (!resolved || !resolved.accounts.some((account) => account.id === accountId)) return null;
  const next = { ...resolved.desk, activeId: accountId };
  desks().set(next.id, next);
  const active = resolved.accounts.find((account) => account.id === accountId) ?? resolved.active;
  return { ...resolved, desk: next, active };
}

/** Removes the active login. The first remaining login becomes the quote account when that one leaves. */
export function removeActiveAccount(request: Request, now = new Date()): { remaining: ResolvedDesk | null; removedId: string | null } {
  const resolved = requestDesk(request, now);
  if (!resolved) return { remaining: null, removedId: null };
  const removedId = resolved.active.id;
  destroyMemorySession(removedId);
  const accountIds = resolved.desk.accountIds.filter((id) => id !== removedId);
  if (accountIds.length === 0) {
    desks().delete(resolved.desk.id);
    return { remaining: null, removedId };
  }
  const next: Desk = {
    ...resolved.desk,
    accountIds,
    activeId: resolved.desk.activeId === removedId ? accountIds[0] : resolved.desk.activeId,
    marketId: resolved.desk.marketId === removedId ? accountIds[0] : resolved.desk.marketId,
  };
  desks().set(next.id, next);
  return { remaining: requestDesk(request, now), removedId };
}

export function toPublicStatus(
  session: StoredSession | null,
  options: { configured: boolean; expired?: boolean; now?: Date; accounts?: PublicAccount[]; secondAccountConfigured?: boolean },
): PublicSessionStatus {
  const { configured: sessionSecretConfigured } = getSessionSecret();
  const accounts = options.accounts ?? (session ? [publicAccount(session, true, true)] : []);
  const secondAccountConfigured = Boolean(options.secondAccountConfigured);
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
      accounts,
      secondAccountConfigured,
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
    accounts,
    secondAccountConfigured,
  };
}

export function accountsForStatus(resolved: ResolvedDesk | null): PublicAccount[] {
  if (!resolved) return [];
  return resolved.accounts
    .slice()
    .sort((left, right) => accountSlot(left) - accountSlot(right))
    .map((account) => publicAccount(account, account.id === resolved.active.id, account.id === resolved.market.id));
}

function publicAccount(session: StoredSession, active: boolean, market: boolean): PublicAccount {
  return {
    id: session.id,
    userId: session.userId,
    userName: session.userShortname || session.userName,
    number: accountSlot(session),
    active,
    market,
  };
}

function savedOrLegacyDesk(id: string, now: Date): Desk | null {
  const saved = desks().get(id);
  if (saved) return saved;
  const legacy = getMemorySession(id, now);
  if (!legacy) return null;
  return { id, accountIds: [legacy.id], activeId: legacy.id, marketId: legacy.id };
}

function accountSlot(session: StoredSession | undefined): 1 | 2 {
  return session?.slot === 2 ? 2 : 1;
}

function insertAccount(desk: Desk, session: StoredSession): Desk {
  const previous = desk.accountIds.map((id) => store().get(id)).find((item) => accountSlot(item) === session.slot);
  if (previous && previous.id !== session.id) destroyMemorySession(previous.id);
  const accountIds = desk.accountIds.filter((id) => id !== previous?.id);
  accountIds.push(session.id);
  return {
    ...desk,
    accountIds,
    activeId: session.id,
    marketId: previous?.id === desk.marketId ? session.id : desk.marketId || session.id,
  };
}

/** Test helper. Not used by request handlers. */
export function clearMemorySessions(): void {
  store().clear();
  desks().clear();
}
