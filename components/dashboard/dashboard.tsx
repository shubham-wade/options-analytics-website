"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ContributionChart, PortfolioPnlChart } from "@/components/dashboard/charts";
import { ExpiryPayoffChart } from "@/components/dashboard/payoff-chart";
import { DailyPnlChart } from "@/components/dashboard/daily-pnl";
import { FiiDiiChart } from "@/components/dashboard/fii-dii";
import { MarketContext, oiLevels, useMarketBrief } from "@/components/dashboard/market-context";
import { FlowNotices } from "@/components/dashboard/flow-notices";
import { DecayStrip } from "@/components/dashboard/decay-strip";
import { DirectionMix } from "@/components/dashboard/direction-mix";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LabHeader } from "@/components/dashboard/lab-header";
import { OrderNotices, playOrderChime, type ShownOrderNotice } from "@/components/dashboard/order-notices";
import { OrderDesk } from "@/components/dashboard/order-desk";
import { Section } from "@/components/dashboard/section";
import { PositionsTable } from "@/components/dashboard/positions-table";
import { ScenarioTable } from "@/components/dashboard/scenario-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatInr, formatIst, formatNumber, formatRupee, formatSigned, pnlClass } from "@/lib/format";
import { summarizeCharges } from "@/lib/kite/charges";
import { callbackErrorMessage } from "@/lib/kite/messages";
import { diffOrders, type PublicPendingOrder } from "@/lib/kite/orders";
import type { PublicPortfolio } from "@/lib/kite/portfolio";
import type { ScenarioResult } from "@/lib/scenario/engine";
import type { PublicSessionStatus } from "@/lib/session/store";
import type { FlowNotice } from "@/lib/flows/fii-dii";
import { DEFAULT_DIVIDEND_YIELD, DEFAULT_RISK_FREE_RATE, DEFAULT_SPOT_MOVES, isNseRegularSession, MODEL_DISCLAIMER } from "@/lib/time";

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
  const brief = useMarketBrief();
  const params = useSearchParams();
  const authError = callbackErrorMessage(params.get("auth_error"));
  const [status, setStatus] = useState<PublicSessionStatus | null>(null);
  const [portfolio, setPortfolio] = useState<PublicPortfolio | null>(null);
  const [orders, setOrders] = useState<PublicPendingOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [notices, setNotices] = useState<ShownOrderNotice[]>([]);
  const [flowNotices, setFlowNotices] = useState<FlowNotice[]>([]);
  const dismissedFlows = useRef(new Set<string>());
  const acceptFlows = useCallback((incoming: FlowNotice[]) => {
    setFlowNotices(incoming.filter((notice) => !dismissedFlows.current.has(notice.key)));
  }, []);
  const orderBookRef = useRef<PublicPendingOrder[] | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [includeFlat, setIncludeFlat] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoTouched = useRef(false);
  const refreshLock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshPulse, setRefreshPulse] = useState(false);
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
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/kite/status", { cache: "no-store" });
    const body = (await response.json()) as PublicSessionStatus;
    setStatus(body);
    return body;
  }, []);

  const loadPositions = useCallback(async (flat: boolean, quiet = false) => {
    if (!quiet) setLoading(true);
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
      if (!quiet) setLoading(false);
    }
  }, [loadStatus]);

  const loadOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/kite/orders", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setOrders(null);
        setOrdersError(body.error ?? "Pending orders could not be loaded.");
        if (response.status === 401) await loadStatus();
        return;
      }
      const next = (Array.isArray(body.orders) ? body.orders : []) as PublicPendingOrder[];
      const found = diffOrders(orderBookRef.current, next);
      orderBookRef.current = next;
      setOrders(next);
      setOrdersError(null);
      if (found.length > 0) {
        const at = new Date().toISOString();
        setNotices((current) => [...found.map((notice) => ({ ...notice, at })), ...current].slice(0, 8));
        playOrderChime();
        if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const notice of found.slice(0, 3)) {
            new Notification(notice.title, { body: notice.detail, tag: notice.key });
          }
        }
      }
    } catch {
      setOrdersError("Pending orders could not be loaded.");
    }
  }, [loadStatus]);

  const refreshBook = useCallback(async (quiet: boolean) => {
    setRefreshing(true);
    try {
      await Promise.all([loadPositions(includeFlat, quiet), loadOrders()]);
      setRefreshedAt(new Date().toISOString());
      setRefreshPulse(true);
    } finally {
      setRefreshing(false);
    }
  }, [includeFlat, loadOrders, loadPositions]);

  useEffect(() => {
    if (!refreshPulse) return;
    const timer = window.setTimeout(() => setRefreshPulse(false), 1400);
    return () => window.clearTimeout(timer);
  }, [refreshPulse]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const followSession = () => {
      if (!autoTouched.current) setAutoRefresh(isNseRegularSession(new Date()));
    };
    followSession();
    const timer = window.setInterval(followSession, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncReport = () => {
      void fetch("/api/report/sync");
    };
    syncReport();
    const timer = window.setInterval(syncReport, 30 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") syncReport();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!status?.connected) {
      setOrders(null);
      setOrdersError(null);
      orderBookRef.current = null;
      return;
    }
    void refreshBook(false);
  }, [includeFlat, status?.connected, status?.accounts?.find((account) => account.active)?.id, refreshBook]);

  useEffect(() => {
    if (!autoRefresh || !status?.connected) return;
    const refresh = () => {
      if (refreshLock.current) return;
      refreshLock.current = true;
      void refreshBook(true).finally(() => {
        refreshLock.current = false;
      });
    };
    const timer = window.setInterval(refresh, 5_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoRefresh, refreshBook, status?.connected]);

  useEffect(() => {
    if (!portfolio) return;
    const live = new Set(portfolio.positions.map((position) => position.id));
    setExcluded((current) => {
      const next = current.filter((id) => live.has(id));
      return next.length === current.length ? current : next;
    });
  }, [portfolio]);

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
              excludeIds: excluded,
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
  }, [divPct, excluded, horizonDays, includeFlat, ivMode, ivPoints, moves, portfolio, ratePct, spotText, status?.connected]);

  useEffect(() => {
    const base = "NIFTY Risk Lab";
    document.title = notices.length > 0 ? `(${notices.length}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [notices.length]);

  async function switchAccount(accountId: string) {
    if (status?.accounts?.find((account) => account.id === accountId)?.active) return;
    const response = await fetch("/api/kite/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    if (!response.ok) return;
    setPortfolio(null);
    setOrders(null);
    setOrdersError(null);
    orderBookRef.current = null;
    setScenario(null);
    setExcluded([]);
    await loadStatus();
  }

  async function logout() {
    await fetch("/api/kite/logout", { method: "POST" });
    setPortfolio(null);
    setOrders(null);
    setOrdersError(null);
    setNotices([]);
    orderBookRef.current = null;
    setScenario(null);
    setExcluded([]);
    await loadStatus();
  }

  const warnings = [...(portfolio?.warnings ?? []), ...(scenario?.warnings ?? [])];
  const greeks = scenario?.currentGreeks;
  const exclusionNote = excluded.length > 0 ? `Excludes ${excluded.length}` : null;
  const withScope = (detail: string) => (exclusionNote ? `${detail} · ${exclusionNote}` : detail);
  const modeledPositions = portfolio?.positions.filter((position) => !excluded.includes(position.id)) ?? [];
  const charges = summarizeCharges(orders);

  function toggleExcluded(id: string) {
    setExcluded((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <TooltipProvider delayDuration={200}>
      <LabHeader kicker="Zerodha" live={portfolio?.spot.quality === "live"} refreshing={refreshing}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/stocks">Stocks</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/paper">Paper</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/report">Report</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/manual">Manual book</Link>
        </Button>
        <ConnectionStatus status={status} />
        {status?.accounts?.map((account) => (
          <Button
            key={account.id}
            size="sm"
            variant={account.active ? "default" : "outline"}
            aria-pressed={account.active}
            title={account.market ? `User ${account.number} supplies NIFTY, India VIX, and option quotes` : `User ${account.number} · ${account.userId}`}
            onClick={() => void switchAccount(account.id)}
          >
            {accountLabel(account)}
          </Button>
        ))}
        {status?.connected ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              refreshing
                ? "border-teal-500/50 bg-teal-500/15 text-teal-900 dark:text-teal-100"
                : refreshPulse
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                  : "border-border text-muted-foreground"
            }`}
            aria-live="polite"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : refreshedAt ? `Updated ${formatIst(refreshedAt)}` : "Waiting"}
          </span>
        ) : null}
        {status?.connected ? (
          <>
            <Button variant="outline" size="sm" onClick={() => void refreshBook(false)} disabled={loading}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
            {status.secondAccountConfigured && status.accounts.length < 2 ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/kite/login?account=${status.accounts.some((account) => account.number === 1) ? 2 : 1}`}>Add account</a>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              Log out
            </Button>
          </>
        ) : status?.configured === false ? (
          <Button size="sm" disabled>Connect Zerodha</Button>
        ) : (
          <Button size="sm" asChild>
            <a href="/api/kite/login">Connect Zerodha</a>
          </Button>
        )}
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">{MODEL_DISCLAIMER}</p>
          <Button size="sm" variant="outline" onClick={() => setNewOrderOpen(true)}>
            New order
          </Button>
        </div>

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

        <Section title="Summary">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">NIFTY 50</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xl tabular">{formatNumber(portfolio?.spot.price, 2)}</span>
                <span className={`font-mono text-sm tabular ${pnlClass(portfolio?.spot.change)}`}>{formatSigned(portfolio?.spot.change, 2)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">India VIX</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`font-mono text-xl tabular ${pnlClass(portfolio?.vix.change)}`}>{formatNumber(portfolio?.vix.price, 2)}</span>
                <span className={`font-mono text-sm tabular ${pnlClass(portfolio?.vix.change)}`}>{formatSigned(portfolio?.vix.change, 2)}</span>
              </div>
            </CardContent>
          </Card>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Metric
                  label="Day's P&L"
                  value={formatInr(portfolio?.brokerDayPnl ?? null)}
                  detail={
                    !portfolio
                      ? "NIFTY options since the previous close"
                      : portfolio.brokerDayPnlComplete
                        ? "Includes contracts closed today"
                        : "Partial — a contract could not be marked"
                  }
                  className={pnlClass(portfolio?.brokerDayPnl)}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Today’s P&L from Kite: cash from today’s buys and sells, the open quantity at the last traded price, and the overnight quantity removed at the previous close. Contracts closed today stay in this total.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Metric
                  label="Charges"
                  value={formatRupee(charges.total)}
                  className={charges.total != null ? "text-rose-700 dark:text-rose-400" : undefined}
                  detail={
                    orders === null
                      ? "Today's completed orders"
                      : charges.count === 0
                        ? "No completed orders today"
                        : charges.complete
                          ? "All completed orders today"
                          : "Partial — a fill has no charge yet"
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Zerodha’s charge total for today’s completed orders: brokerage, STT, exchange transaction charge, SEBI fee, stamp duty, and GST.
            </TooltipContent>
          </Tooltip>
          <Metric label="Portfolio delta" value={formatNumber(greeks?.delta ?? null, 1)} detail={withScope(greeks && !greeks.complete ? "Partial" : "Model, per point")} />
          <Metric label="Portfolio gamma" value={formatNumber(greeks?.gamma ?? null, 4)} detail={withScope("Per one index point")} />
          <Metric label="Theta / day" value={formatNumber(greeks?.thetaPerDay ?? null)} detail={withScope("Calendar day")} className={pnlClass(greeks?.thetaPerDay)} />
          <Metric label="Vega / point" value={formatNumber(greeks?.vegaPerPoint ?? null)} detail={withScope("Per 1 vol point")} />
          <Metric label="Open positions" value={portfolio ? String(portfolio.openCount) : "—"} detail={portfolio ? `${portfolio.flatCount} flat hidden or listed` : "Net NIFTY options"} />
        </div>
        </Section>

        {portfolio && (portfolio.openCount > 0 || (scenario?.decay?.length ?? 0) > 0) ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {portfolio.openCount > 0 ? (
              <DirectionMix
                positions={modeledPositions}
                greeks={scenario?.positionGreeks ?? []}
              />
            ) : null}
            {scenario && (scenario.decay?.length ?? 0) > 0 ? <DecayStrip points={scenario.decay} /> : null}
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Section title="Connection" contentClassName="space-y-3 text-sm text-muted-foreground">
              <p>{status?.connected ? `Positions for ${accountLabel(status.accounts.find((account) => account.active) ?? { number: 1, userName: status.userName ?? "account" })}` : "Not connected."}</p>
              <p>
                {status?.accounts?.find((account) => account.market)
                  ? `Quotes use ${accountLabel(status.accounts.find((account) => account.market)!)}. Positions and orders come from the selected account.`
                  : "Connect Zerodha to load a book."}
              </p>
              {status?.connected && status.accounts.length < 2 && !status.secondAccountConfigured ? (
                <p>The second login needs its own Kite app: KITE_API_KEY_2 and KITE_API_SECRET_2.</p>
              ) : null}
              <p>Session expires {status?.expiresAt ? formatIst(status.expiresAt) : "after the next Zerodha login"} IST.</p>
              <p className={refreshPulse ? "text-emerald-700 dark:text-emerald-300" : undefined}>
                Last refresh {refreshedAt ? formatIst(refreshedAt) : portfolio ? formatIst(portfolio.fetchedAt) : "—"}.
              </p>
              <p>Spot exchange time {portfolio?.spot.exchangeTimestamp ? formatIst(portfolio.spot.exchangeTimestamp) : "—"}.</p>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="flat">Show flat</Label>
                <Switch id="flat" checked={includeFlat} onCheckedChange={setIncludeFlat} disabled={!status?.connected} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="auto">Refresh every 5s</Label>
                <Switch
                  id="auto"
                  checked={autoRefresh}
                  onCheckedChange={(checked) => {
                    autoTouched.current = true;
                    setAutoRefresh(checked);
                  }}
                  disabled={!status?.connected}
                />
              </div>
              <p>On during the regular NSE session, 9:15–15:30 IST. Five seconds stays under Kite’s quote limit of about one call per second.</p>
          </Section>
          <Section title="Positions">
              {portfolio ? (
                <PositionsTable
                  portfolio={portfolio}
                  greeks={scenario?.positionGreeks ?? []}
                  excludedIds={excluded}
                  onToggleExcluded={toggleExcluded}
                  onPlaced={() => void refreshBook(false)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Connect Zerodha to load the net NIFTY option book.</p>
              )}
          </Section>
        </section>

        <OrderDesk
          orders={orders}
          connected={Boolean(status?.connected)}
          error={ordersError}
          onDone={() => void refreshBook(false)}
          composerOpen={newOrderOpen}
          onComposerOpenChange={setNewOrderOpen}
        />

        <Section title="Scenario controls" defaultOpen={false} contentClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        </Section>

        {!moves ? <Banner tone="warn">Enter 1 to 15 finite moves between -5000 and 5000, separated by commas.</Banner> : null}

        {modeledPositions.some((position) => position.quantity !== 0) ? (
          <Section title="Expiry profit and loss">
            <ExpiryPayoffChart
              legs={modeledPositions.filter((position) => position.quantity !== 0).map((position) => ({
                right: position.optionType,
                strike: position.strike ?? Number.NaN,
                quantity: position.quantity,
                multiplier: position.multiplier,
                entryPremium: position.averagePrice,
                marketPremium: position.quote.price,
              }))}
              spot={spotText.trim() ? Number(spotText) : portfolio?.spot.price ?? null}
              levels={oiLevels(brief)}
            />
          </Section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-2">
          <Section title={`Portfolio scenario P&L${scenarioLoading ? " · updating" : ""}`}>
            {scenario && scenario.rows.length > 0 ? <PortfolioPnlChart scenario={scenario} /> : <EmptyChart />}
          </Section>
          <Section
            title="Position contribution"
            aside={
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
            }
          >
            {scenario && scenario.rows.length > 0 ? (
              <ContributionChart scenario={scenario} move={focusMove} />
            ) : (
              <EmptyChart />
            )}
          </Section>
        </section>

        <Section title="Scenario P&L">
          {scenario && scenario.rows.length > 0 ? <ScenarioTable scenario={scenario} /> : <EmptyChart />}
        </Section>

        <DailyPnlChart />

        <FiiDiiChart onNotices={acceptFlows} />

        <MarketContext brief={brief} future={portfolio?.future} />

        <section className="grid gap-4 lg:grid-cols-2">
          <Section title="Model assumptions" contentClassName="space-y-2 text-sm text-muted-foreground">
              <p>European Black–Scholes–Merton. Forward = spot × exp((rate − dividend yield) × time).</p>
              <p>Day count is ACT/365. Theta is per calendar day. Vega is per one volatility point.</p>
              <p>IV is calibrated from the bid/ask midpoint when both are valid, otherwise from the last traded price.</p>
              <p>{scenario?.settlementAssumption}</p>
              <p>Broker unrealised, realised and net P&L are copied from Kite. Model trade P&L uses signed quantity × multiplier × (theoretical premium − average price) and can differ because of charges and broker conventions.</p>
              <p>Kite quotes do not include Greeks. Nothing here is an order.</p>
          </Section>
          <Section title="Data quality" contentClassName="space-y-2 text-sm text-muted-foreground">
              {warnings.length === 0 ? <p>No data-quality warnings on the latest snapshot.</p> : null}
              {warnings.slice(0, 8).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <p>
                Instrument master cache: {portfolio ? formatIst(portfolio.instrumentCacheFetchedAt) : "—"}
                {portfolio?.instrumentCacheHit ? " (cached)" : ""}. Exchange holidays are not on a local calendar.
              </p>
          </Section>
        </section>
      </main>
      {notices.length > 0 || flowNotices.length > 0 ? (
        <div className="fixed right-4 top-28 z-50 flex w-[min(100vw-2rem,22rem)] flex-col gap-2" aria-live="assertive">
          <OrderNotices
            embedded
            notices={notices}
            onDismiss={(key) => setNotices((current) => current.filter((notice) => notice.key !== key))}
            onDismissAll={() => setNotices([])}
          />
          <FlowNotices
            notices={flowNotices}
            onDismiss={(key) => {
              dismissedFlows.current.add(key);
              setFlowNotices((current) => current.filter((notice) => notice.key !== key));
            }}
            onDismissAll={() => {
              for (const notice of flowNotices) dismissedFlows.current.add(notice.key);
              setFlowNotices([]);
            }}
          />
        </div>
      ) : null}
    </TooltipProvider>
  );
}

function accountLabel(account: { number: number; userName: string }): string {
  return `User ${account.number} · ${account.userName}`;
}

function ConnectionStatus({ status }: { status: PublicSessionStatus | null }) {
  if (!status) return <Badge>Checking</Badge>;
  if (!status.configured) return <Badge className="border-amber-600/40 text-amber-800 dark:text-amber-200">Credentials missing</Badge>;
  if (status.connected) return <Badge className="border-emerald-600/40 text-emerald-700 dark:text-emerald-300">Connected</Badge>;
  if (status.expired) return <Badge className="border-rose-600/40 text-rose-700 dark:text-rose-300">Session expired</Badge>;
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
          ? "rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
          : "rounded-md border border-sky-600/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-950 dark:text-sky-100"
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
