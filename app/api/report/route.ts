import { NextResponse } from "next/server";
import { portfolioForRequest } from "@/lib/kite/guard";
import { valueSnapshot, DEFAULT_SCENARIO } from "@/lib/kite/portfolio";
import { ensureDueReports, loadMarketReport } from "@/lib/report/load";
import { latestReportDate, reportSessions } from "@/lib/report/sessions";
import type { PortfolioReport } from "@/lib/report/types";
import { DEFAULT_SPOT_MOVES } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const now = new Date();
  const latest = latestReportDate(now);
  try {
    if (!refresh) await ensureDueReports(now);
    const report = await loadMarketReport(now, refresh, url.searchParams.get("date"));
    if (report.asOf === latest) report.portfolio = await readPortfolio(request);
    return NextResponse.json(
      { ...report, latest, sessions: reportSessions(latest) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The report could not be built.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function readPortfolio(request: Request): Promise<PortfolioReport | null> {
  const loaded = await portfolioForRequest(request, false);
  if (!("snapshot" in loaded)) return null;
  try {
    const base = valueSnapshot(loaded.snapshot, { ...DEFAULT_SCENARIO, spot: null, moves: [...DEFAULT_SPOT_MOVES] });
    const up = valueSnapshot(loaded.snapshot, { ...DEFAULT_SCENARIO, spot: null, moves: [0], ivMode: "up", ivPoints: 2 });
    const down = valueSnapshot(loaded.snapshot, { ...DEFAULT_SCENARIO, spot: null, moves: [0], ivMode: "down", ivPoints: 2 });
    const greeks = new Map(base.positionGreeks.map((row) => [row.id, row.delta]));
    const byExpiry = new Map<string, number>();
    for (const position of loaded.snapshot.positions) {
      const key = position.expiry ?? "Unknown expiry";
      byExpiry.set(key, (byExpiry.get(key) ?? 0) + position.quantity);
    }
    return {
      connected: true,
      delta: base.currentGreeks.delta,
      gamma: base.currentGreeks.gamma,
      thetaPerDay: base.currentGreeks.thetaPerDay,
      vegaPerPoint: base.currentGreeks.vegaPerPoint,
      scenarios: base.columns.map((column) => ({ move: column.move, pnl: column.portfolioIncrementalPnl })),
      ivUpPnl: up.columns[0]?.portfolioIncrementalPnl ?? null,
      ivDownPnl: down.columns[0]?.portfolioIncrementalPnl ?? null,
      ivPoints: 2,
      largest: [...loaded.snapshot.positions]
        .map((position) => ({ symbol: position.tradingSymbol, delta: greeks.get(position.id) ?? null, expiry: position.expiry }))
        .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
        .slice(0, 5),
      byExpiry: [...byExpiry.entries()].map(([expiry, contracts]) => ({ expiry, contracts })),
    };
  } catch {
    return null;
  }
}
