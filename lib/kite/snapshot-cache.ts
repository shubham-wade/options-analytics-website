import type { PortfolioSnapshot } from "@/lib/kite/portfolio";

interface Entry {
  at: number;
  includeFlat: boolean;
  snapshot: PortfolioSnapshot;
}

const globalSnapshots = globalThis as typeof globalThis & {
  __niftySnapshots?: Map<string, Entry>;
};

function cache(): Map<string, Entry> {
  if (!globalSnapshots.__niftySnapshots) globalSnapshots.__niftySnapshots = new Map();
  return globalSnapshots.__niftySnapshots;
}

export function rememberSnapshot(sessionId: string, includeFlat: boolean, snapshot: PortfolioSnapshot): void {
  cache().set(sessionId, { at: Date.now(), includeFlat, snapshot });
}

export function recentSnapshot(sessionId: string, includeFlat: boolean, maxAgeMs = 20_000): PortfolioSnapshot | null {
  const hit = cache().get(sessionId);
  if (!hit || hit.includeFlat !== includeFlat) return null;
  if (Date.now() - hit.at > maxAgeMs) return null;
  return hit.snapshot;
}

export function forgetSnapshot(sessionId: string): void {
  cache().delete(sessionId);
}
