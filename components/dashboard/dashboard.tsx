"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ContributionChart, PortfolioPnlChart } from "@/components/dashboard/charts";
import { PositionsTable, qualityLabel } from "@/components/dashboard/positions-table";
import { ScenarioTable } from "@/components/dashboard/scenario-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatInr, formatIst, formatNumber, pnlClass } from "@/lib/format";
import { callbackErrorMessage } from "@/lib/kite/messages";
import type { PublicPortfolio } from "@/lib/kite/portfolio";
import type { ScenarioResult } from "@/lib/scenario/engine";
import type { PublicSessionStatus } from "@/lib/session/store";
import { DEFAULT_DIVIDEND_YIELD, DEFAULT_RISK_FREE_RATE, DEFAULT_SPOT_MOVES, MODEL_DISCLAIMER } from "@/lib/time";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function parseMoves(text: string): number[] | null {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 15) return null;
  const moves = parts.map((part) => Number(part.replace("−", "-")));
  if (moves.some((move) => !Number.isFinite(move) || move < -5000 || move > 5000)) return null;
  return moves;
}

export function Dashboard() {
  const params = useSearchParams();
  const authError = callbackErrorMessage(params.get("auth_error"));
  const [status, setStatus] = useState<PublicSessionStatus | null>(null);
  const [portfolio, setPortfolio] = useState<PublicPortfolio | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [includeFlat, setIncludeFlat] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveText, setMoveText] = useState(DEFAULT_SPOT_MOVES.join(", "));
  const [spotText, setSpotText] = useState("");
  const [horizon, setHorizon] = useState("0");
  const [customDays, setCustomDays] = useState("2");
  const [ivMode, setIvMode] = useState<"constant" | "up" | "down">("constant");
  const [ivPoints, setIvPoints] = useState("3");
  const [ratePct, setRatePct] = useState(String(DEFAULT_RISK_FREE_RATE * 100));
  const [divPct, setDivPct] = useState(String(DEFAULT_DIVIDEND_YIELD * 100));
  const [focusMove, setFocusMove] = useState(-100);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/kite/status", { cache: "no-store" });
    const body = (await response.json()) as PublicSessionStatus;
    setStatus(body);
    return body;
  }, []);

  const loadPositions = useCallback(async (flat: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/kite/positions?includeFlat=${flat ? "1" : "0"}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setPortfolio(null);
        setScenario(null);
        setError(body.error ?? "Positions could not be loaded.");
        if (response.status === 401) await loadStatus();
        return;
      }
      setPortfolio(body as PublicPortfolio);
    } catch {
      setError("Positions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    void loadPositions(includeFlat);
  }, [includeFlat, status?.connected, loadPositions]);

  useEffect(() => {
    if (!autoRefresh || !status?.connected) return;
    const timer = window.setInterval(() => {
      void loadPositions(includeFlat);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, includeFlat, loadPositions, status?.connected]);

  const moves = useMemo(() => parseMoves(moveText), [moveText]);
  const horizonDays = horizon === "custom" ? Number(customDays) : Number(horizon);

  useEffect(() => {
    if (!portfolio || !status?.connected || !moves) return;
    const spot = spotText.trim() === "" ? null : Number(spotText);
    if (spot !== null && (!Number.isFinite(spot) || spot <= 0)) return;
    const handle = window.setTimeout(() => {
      void (async () => {
        setScenarioLoading(true);
        try {
          const response = await fetch("/api/kite/scenario", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeFlat,
              spot,
              moves,
              horizonDays,
              ivMode,
              ivPoints: ivMode === "constant" ? 0 : Number(ivPoints),
              rate: Number(ratePct) / 100,
              dividendYield: Number(divPct) / 100,
            }),
          });
          const body = await response.json();
          if (!response.ok) {
            setError(body.error ?? "Scenario calculation failed.");
            return;
          }
          setScenario(body as ScenarioResult);
          setError(null);
        } catch {
          setError("Scenario calculation failed.");
        } finally {
          setScenarioLoading(false);
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [divPct, horizonDays, includeFlat, ivMode, ivPoints, moves, portfolio, ratePct, spotText, status?.connected]);

  async function logout() {
    await fetch("/api/kite/logout", { method: "POST" });
    setPortfolio(null);
    setScenario(null);
    await loadStatus();
  }

  const warnings = [...(portfolio?.warnings ?? []), ...(scenario?.warnings ?? [])];
  const greeks = scenario?.currentGreeks;

  return (
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-teal-300/80">Zerodha · read only</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">NIFTY Risk Lab</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{MODEL_DISCLAIMER}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectionStatus status={status} />
            {status?.connected ? (
              <>
                <Button variant="outline" onClick={() => void loadPositions(includeFlat)} disabled={loading}>
                  <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  Refresh
                </Button>
                <Button variant="ghost" onClick={() => void logout()}>
                  Log out
                </Button>
              </>
            ) : status?.configured === false ? (
              <Button disabled>Connect Zerodha</Button>
            ) : (
              <Button asChild>
                <a href="/api/kite/login">Connect Zerodha</a>
              </Button>
            )}
          </div>
        </header>

        {authError ? <Banner tone="warn">{authError}</Banner> : null}
        {status?.expired ? (
          <Banner tone="warn">
            The Zerodha session expired at 06:00 IST, was invalidated, or was lost because this server keeps sessions
            in memory. Connect again. There is no refresh token.
          </Banner>
        ) : null}
        {status && !status.sessionSecretConfigured ? (
          <Banner tone="info">
            SESSION_SECRET is not set. The cookie signature is process-local and will not survive a restart.
          </Banner>
        ) : null}
        {error ? <Banner tone="warn">{error}</Banner> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <Metric label="NIFTY 50" value={formatNumber(portfolio?.spot.price, 2)} detail={portfolio ? qualityLabel(portfolio.spot.quality) : "—"} />
          <Metric label="Open positions" value={portfolio ? String(portfolio.openCount) : "—"} detail={portfolio ? `${portfolio.flatCount} flat hidden or listed` : "Net NIFTY options"} />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Metric
                  label="Broker unrealised"
                  value={formatInr(portfolio?.brokerUnrealised ?? null)}
                  detail="Sum of Kite unrealised"
                  className={pnlClass(portfolio?.brokerUnrealised)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              This is the broker field unrealised from the net positions response. It is not the model scenario P&L.
            </TooltipContent>
          </Tooltip>
          <Metric label="Portfolio delta" value={formatNumber(greeks?.delta ?? null, 1)} detail={greeks && !greeks.complete ? "Partial" : "Model, per point"} />
          <Metric label="Portfolio gamma" value={formatNumber(greeks?.gamma ?? null, 4)} detail="Per one index point" />
          <Metric label="Theta / day" value={formatNumber(greeks?.thetaPerDay ?? null)} detail="Calendar day" className={pnlClass(greeks?.thetaPerDay)} />
          <Metric label="Vega / point" value={formatNumber(greeks?.vegaPerPoint ?? null)} detail="Per 1 vol point" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{status?.connected ? `Signed in as ${status.userName}` : "Not connected."}</p>
              <p>Session expires {status?.expiresAt ? formatIst(status.expiresAt) : "after the next Zerodha login"} IST.</p>
              <p>Last refresh {portfolio ? formatIst(portfolio.fetchedAt) : "—"}.</p>
              <p>Spot exchange time {portfolio?.spot.exchangeTimestamp ? formatIst(portfolio.spot.exchangeTimestamp) : "—"}.</p>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="flat">Show flat</Label>
                <Switch id="flat" checked={includeFlat} onCheckedChange={setIncludeFlat} disabled={!status?.connected} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="auto">Refresh every 20s</Label>
                <Switch id="auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} disabled={!status?.connected} />
              </div>
              <p>Quote calls stay near one per second. Auto-refresh is off until you enable it.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Positions</CardTitle>
            </CardHeader>
            <CardContent>
              {portfolio ? (
                <PositionsTable portfolio={portfolio} greeks={scenario?.positionGreeks ?? []} />
              ) : (
                <p className="text-sm text-muted-foreground">Connect Zerodha to load the net NIFTY option book.</p>
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Scenario controls</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Starting spot" hint="Blank uses the NIFTY 50 quote">
              <Input value={spotText} onChange={(event) => setSpotText(event.target.value)} inputMode="decimal" placeholder={portfolio?.spot.price ? String(portfolio.spot.price) : "Market"} />
            </Field>
            <Field label="NIFTY moves" hint="Points from the starting spot">
              <Input value={moveText} onChange={(event) => setMoveText(event.target.value)} />
            </Field>
            <Field label="Time horizon">
              <select className={selectClass} value={horizon} onChange={(event) => setHorizon(event.target.value)} aria-label="Time horizon">
                <option value="0">Immediate</option>
                <option value="1">1 calendar day</option>
                <option value="3">3 calendar days</option>
                <option value="7">7 calendar days</option>
                <option value="custom">Custom calendar days</option>
              </select>
            </Field>
            <Field label="Custom days">
              <Input value={customDays} onChange={(event) => setCustomDays(event.target.value)} inputMode="numeric" disabled={horizon !== "custom"} />
            </Field>
            <Field label="Volatility">
              <select className={selectClass} value={ivMode} onChange={(event) => setIvMode(event.target.value as "constant" | "up" | "down")} aria-label="Volatility scenario">
                <option value="constant">Constant IV</option>
                <option value="up">IV up</option>
                <option value="down">IV down</option>
              </select>
            </Field>
            <Field label="IV shift (points)" hint="3 points turns 20% into 23%">
              <Input value={ivPoints} onChange={(event) => setIvPoints(event.target.value)} inputMode="decimal" disabled={ivMode === "constant"} />
            </Field>
            <Field label="Interest rate %" hint="Model input, not from Zerodha">
              <Input value={ratePct} onChange={(event) => setRatePct(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Dividend yield %">
              <Input value={divPct} onChange={(event) => setDivPct(event.target.value)} inputMode="decimal" />
            </Field>
          </CardContent>
        </Card>

        {!moves ? <Banner tone="warn">Enter 1 to 15 finite moves between -5000 and 5000, separated by commas.</Banner> : null}

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio scenario P&L {scenarioLoading ? "· updating" : ""}</CardTitle>
            </CardHeader>
            <CardContent>
              {scenario && scenario.rows.length > 0 ? <PortfolioPnlChart scenario={scenario} /> : <EmptyChart />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Position contribution</CardTitle>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={focusMove}
                onChange={(event) => setFocusMove(Number(event.target.value))}
                aria-label="Contribution scenario"
              >
                {(scenario?.moves ?? [...DEFAULT_SPOT_MOVES]).map((move) => (
                  <option key={move} value={move}>
                    {move > 0 ? `+${move}` : move}
                  </option>
                ))}
              </select>
            </CardHeader>
            <CardContent>
              {scenario && scenario.rows.length > 0 ? (
                <ContributionChart scenario={scenario} move={focusMove} />
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Scenario P&L</CardTitle>
          </CardHeader>
          <CardContent>
            {scenario && scenario.rows.length > 0 ? <ScenarioTable scenario={scenario} /> : <EmptyChart />}
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Model assumptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>European Black–Scholes–Merton. Forward = spot × exp((rate − dividend yield) × time).</p>
              <p>Day count is ACT/365. Theta is per calendar day. Vega is per one volatility point.</p>
              <p>IV is calibrated from the bid/ask midpoint when both are valid, otherwise from the last traded price.</p>
              <p>{scenario?.settlementAssumption}</p>
              <p>Broker unrealised, realised and net P&L are copied from Kite. Model trade P&L uses signed quantity × multiplier × (theoretical premium − average price) and can differ because of charges and broker conventions.</p>
              <p>Kite quotes do not include Greeks. Nothing here is an order.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Data quality</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {warnings.length === 0 ? <p>No data-quality warnings on the latest snapshot.</p> : null}
              {warnings.slice(0, 8).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <p>
                Instrument master cache: {portfolio ? formatIst(portfolio.instrumentCacheFetchedAt) : "—"}
                {portfolio?.instrumentCacheHit ? " (cached)" : ""}. Exchange holidays are not on a local calendar.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </TooltipProvider>
  );
}

function ConnectionStatus({ status }: { status: PublicSessionStatus | null }) {
  if (!status) return <Badge>Checking</Badge>;
  if (!status.configured) return <Badge className="border-amber-500/40 text-amber-200">Credentials missing</Badge>;
  if (status.connected) return <Badge className="border-emerald-500/40 text-emerald-300">Connected</Badge>;
  if (status.expired) return <Badge className="border-rose-500/40 text-rose-300">Session expired</Badge>;
  return <Badge>Disconnected</Badge>;
}

function Metric({ label, value, detail, className }: { label: string; value: string; detail: string; className?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`font-mono text-xl tabular ${className ?? ""}`}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Banner({ children, tone }: { children: ReactNode; tone: "warn" | "info" }) {
  return (
    <div
      role="status"
      className={
        tone === "warn"
          ? "rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          : "rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
      }
    >
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      Scenario results appear after a connected portfolio is priced.
    </p>
  );
}
