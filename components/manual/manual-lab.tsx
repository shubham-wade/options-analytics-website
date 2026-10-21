"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ContributionChart, PortfolioPnlChart } from "@/components/dashboard/charts";
import { ExpiryPayoffChart } from "@/components/dashboard/payoff-chart";
import { DecayStrip } from "@/components/dashboard/decay-strip";
import { DirectionMix } from "@/components/dashboard/direction-mix";
import { ScenarioTable } from "@/components/dashboard/scenario-table";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatInr, formatIst, formatNumber, formatPercentPoints, pnlClass } from "@/lib/format";
import {
  includedScenarioPositions,
  isBlankManualDraft,
  prepareManualLeg,
  type ManualEntry,
  type PreparedManualLeg,
} from "@/lib/manual/book";
import type { ListedNiftyOption, ManualLookup } from "@/lib/kite/lookup";
import { parseNiftyOptionSymbol } from "@/lib/kite/positions";
import { markedFromClosePnl, sumNullable } from "@/lib/pricing/pnl";
import { runScenarios, ScenarioInputError, type IvMode, type ScenarioResult } from "@/lib/scenario/engine";
import type { PublicSessionStatus } from "@/lib/session/store";
import { DEFAULT_DIVIDEND_YIELD, DEFAULT_RISK_FREE_RATE, DEFAULT_SPOT_MOVES, MODEL_DISCLAIMER } from "@/lib/time";
import { qualityLabel } from "@/components/dashboard/positions-table";

const STORAGE_KEY = "nrl-manual-book";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface StoredBook {
  spot: string;
  rows: ManualEntry[];
  moveText: string;
  horizon: string;
  customDays: string;
  ivMode: IvMode;
  ivPoints: string;
  ratePct: string;
  divPct: string;
}

const blankEntry = (): ManualEntry => ({
  id: "draft",
  symbol: "",
  quantity: "",
  average: "",
  price: "",
  expiry: "",
  included: true,
});

export function ManualLab() {
  const [spotText, setSpotText] = useState("");
  const [rows, setRows] = useState<ManualEntry[]>([blankEntry()]);
  const [moveText, setMoveText] = useState(DEFAULT_SPOT_MOVES.join(", "));
  const [horizon, setHorizon] = useState("0");
  const [customDays, setCustomDays] = useState("2");
  const [ivMode, setIvMode] = useState<IvMode>("constant");
  const [ivPoints, setIvPoints] = useState("3");
  const [ratePct, setRatePct] = useState(String(DEFAULT_RISK_FREE_RATE * 100));
  const [divPct, setDivPct] = useState(String(DEFAULT_DIVIDEND_YIELD * 100));
  const [focusMove, setFocusMove] = useState(-100);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState<ManualLookup | null>(null);
  const [catalog, setCatalog] = useState<ListedNiftyOption[]>([]);
  const [picks, setPicks] = useState<Record<string, ContractPick>>({});

  useEffect(() => {
    const stored = readStoredBook();
    if (stored) {
      setSpotText(stored.spot);
      setRows(stored.rows.length > 0 ? stored.rows : [freshEntry()]);
      setMoveText(stored.moveText);
      setHorizon(stored.horizon);
      setCustomDays(stored.customDays);
      setIvMode(stored.ivMode);
      setIvPoints(stored.ivPoints);
      setRatePct(stored.ratePct);
      setDivPct(stored.divPct);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const book: StoredBook = { spot: spotText, rows, moveText, horizon, customDays, ivMode, ivPoints, ratePct, divPct };
    const existing = readStoredBook();
    if (existing && isBlankManualDraft(book.rows, book.spot) && !isBlankManualDraft(existing.rows, existing.spot)) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
  }, [ready, spotText, rows, moveText, horizon, customDays, ivMode, ivPoints, ratePct, divPct]);

  const symbolKey = rows
    .map((row) => row.symbol.trim().toUpperCase())
    .filter((symbol) => parseNiftyOptionSymbol(symbol))
    .sort()
    .join("|");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const symbols = symbolKey ? symbolKey.split("|") : [];

    async function refreshLive() {
      try {
        const statusResponse = await fetch("/api/kite/status", { cache: "no-store" });
        const status = (await statusResponse.json()) as PublicSessionStatus;
        if (cancelled) return;
        setConnected(Boolean(status.connected));
        if (!status.connected) {
          setLive(null);
          return;
        }
        const response = await fetch("/api/kite/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols }),
        });
        if (!response.ok) {
          if (!cancelled) setLive(null);
          return;
        }
        const body = (await response.json()) as ManualLookup;
        if (!cancelled) setLive(body);
      } catch {
        if (!cancelled) setLive(null);
      }
    }

    const start = window.setTimeout(() => void refreshLive(), 300);
    const timer = window.setInterval(() => void refreshLive(), 20_000);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [ready, symbolKey]);

  useEffect(() => {
    if (!ready || !connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/kite/contracts", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { contracts?: ListedNiftyOption[] };
        if (!cancelled && Array.isArray(body.contracts)) setCatalog(body.contracts);
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, connected]);

  const liveBySymbol = new Map((live?.contracts ?? []).map((contract) => [contract.symbol, contract]));
  const effectiveRows = rows.map((row) => {
    const quote = liveBySymbol.get(row.symbol.trim().toUpperCase());
    return {
      ...row,
      expiry: row.expiry.trim() || quote?.expiry || "",
      price: quote?.price != null ? String(quote.price) : "",
    };
  });
  const effectiveSpot = spotText.trim() || (live?.spot.price != null ? String(live.spot.price) : "");

  const moves = useMemo(() => parseMoves(moveText), [moveText]);
  const horizonDays = horizon === "custom" ? Number(customDays) : Number(horizon);
  const model = useMemo(() => {
    const now = new Date();
    const legs = effectiveRows.map((row) => prepareManualLeg(row, now));
    const positions = includedScenarioPositions(effectiveRows, legs);
    const spot = Number(effectiveSpot);
    let scenario: ScenarioResult | null = null;
    let modelError: string | null = null;
    if (positions.length > 0 && moves && Number.isFinite(spot) && spot > 0 && Number.isFinite(horizonDays)) {
      try {
        scenario = runScenarios({
          baseSpot: spot,
          moves,
          horizonDays,
          ivMode,
          ivPoints: ivMode === "constant" ? 0 : Number(ivPoints),
          rate: Number(ratePct) / 100,
          dividendYield: Number(divPct) / 100,
          positions,
        });
      } catch (error) {
        modelError = error instanceof ScenarioInputError ? error.message : "The scenario could not be priced.";
      }
    }
    return { now, legs, scenario, modelError };
  }, [divPct, effectiveRows, effectiveSpot, horizonDays, ivMode, ivPoints, moves, ratePct]);

  const legById = new Map(model.legs.map((leg) => [leg.id, leg]));
  const dayCandidates = model.legs.flatMap((leg) => {
    if (!leg.tradingSymbol || leg.quantity === null) return [];
    const quote = liveBySymbol.get(leg.tradingSymbol);
    return [{ id: leg.id, pnl: markedFromClosePnl(leg.quantity, leg.price, quote?.previousClose ?? null) }];
  });
  const dayBook = sumNullable(dayCandidates.map((candidate) => candidate.pnl));
  const dayById = new Map(dayCandidates.map((candidate) => [candidate.id, candidate.pnl]));
  const greeks = model.scenario?.currentGreeks;
  const excludedCount = rows.filter((row) => !row.included && legById.get(row.id)?.position).length;
  const scope = excludedCount > 0 ? `Excludes ${excludedCount}` : null;
  const withScope = (detail: string) => (scope ? `${detail} · ${scope}` : detail);
  const modeledPositions = model.legs.flatMap((leg) => {
    const entry = rows.find((row) => row.id === leg.id);
    if (!entry?.included || !leg.position || !leg.optionType || leg.quantity === null || !leg.side) return [];
    return [{ id: leg.id, optionType: leg.optionType, side: leg.side, quantity: leg.quantity }];
  });
  const focusChoices = model.scenario?.moves ?? [...DEFAULT_SPOT_MOVES];
  const selectedFocus = focusChoices.includes(focusMove) ? focusMove : focusChoices[0] ?? 0;

  function updateRow(id: string, patch: Partial<ManualEntry>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => {
      const next = current.filter((item) => item.id !== id);
      return next.length > 0 ? next : [freshEntry()];
    });
    setPicks((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function chooseContract(id: string, expiry: string, strike: string, right: string) {
    const strikeStillListed = catalog.some((contract) => contract.expiry === expiry && String(contract.strike) === strike);
    const nextStrike = strikeStillListed ? strike : "";
    const rightStillListed = catalog.some(
      (contract) => contract.expiry === expiry && String(contract.strike) === nextStrike && contract.optionType === right,
    );
    const nextRight = rightStillListed ? right : "";
    const match = catalog.find(
      (contract) => contract.expiry === expiry && String(contract.strike) === nextStrike && contract.optionType === nextRight,
    );
    if (match) {
      updateRow(id, { symbol: match.symbol, expiry: match.expiry });
      setPicks((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setPicks((current) => ({ ...current, [id]: { expiry, strike: nextStrike, right: nextRight } }));
  }

  return (
    <>
    <LabHeader kicker="Manual book · read only" live={live?.spot.quality === "live"}>
      <ThemeToggle />
      <Button variant="outline" size="sm" asChild>
        <Link href="/">Zerodha book</Link>
      </Button>
    </LabHeader>
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Contracts you type stay in this browser until you edit or remove them. A refresh or server restart does not clear them. Nothing on this page places an order.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="NIFTY spot"
            hint={spotText.trim() ? "The scenario moves start from this level" : "Blank uses the live NIFTY 50 quote when Zerodha is connected"}
          >
            <Input value={spotText} onChange={(event) => setSpotText(event.target.value)} inputMode="decimal" placeholder={live?.spot.price ? String(live.spot.price) : "25200"} />
          </Field>
          <p className="text-xs text-muted-foreground">
            Quantity is signed option units. A negative quantity is a short. Choose the contract from the Zerodha list. Current price always comes from the live Kite quote.
            {connected
              ? ` Zerodha is connected${live?.fetchedAt ? `, quotes as of ${formatIst(live.fetchedAt)}` : ""}.`
              : " Connect on the Zerodha page to fill those live fields. Typed values are kept either way."}
          </p>
          {rows.map((row) => {
            const leg = legById.get(row.id);
            const quote = liveBySymbol.get(row.symbol.trim().toUpperCase());
            const listed = catalog.find((contract) => contract.symbol === row.symbol.trim().toUpperCase());
            const pick = picks[row.id] ?? {
              expiry: listed?.expiry ?? "",
              strike: listed ? String(listed.strike) : "",
              right: listed?.optionType ?? "",
            };
            const expiries = [...new Set(catalog.map((contract) => contract.expiry))];
            const strikes = catalog.filter((contract) => contract.expiry === pick.expiry).map((contract) => contract.strike);
            const uniqueStrikes = [...new Set(strikes)].sort((left, right) => left - right);
            const rights = [
              ...new Set(
                catalog
                  .filter((contract) => contract.expiry === pick.expiry && String(contract.strike) === pick.strike)
                  .map((contract) => contract.optionType),
              ),
            ];
            return (
              <div key={row.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-6">
                <Field label="Expiry" hint={catalog.length === 0 ? "Connect Zerodha to load the contract list" : "Listed NIFTY expiries"}>
                  <select
                    className={selectClass}
                    aria-label="Contract expiry"
                    value={pick.expiry}
                    disabled={catalog.length === 0}
                    onChange={(event) => chooseContract(row.id, event.target.value, pick.strike, pick.right)}
                  >
                    <option value="">{catalog.length === 0 ? "Connect Zerodha" : "Select expiry"}</option>
                    {expiries.map((expiry) => (
                      <option key={expiry} value={expiry}>
                        {formatExpiryLabel(expiry)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Strike">
                  <select
                    className={selectClass}
                    aria-label="Contract strike"
                    value={pick.strike}
                    disabled={!pick.expiry || catalog.length === 0}
                    onChange={(event) => chooseContract(row.id, pick.expiry, event.target.value, pick.right)}
                  >
                    <option value="">Select strike</option>
                    {uniqueStrikes.map((strike) => (
                      <option key={strike} value={strike}>
                        {strike.toLocaleString("en-IN")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Call or put" hint={row.symbol ? row.symbol : "Choose all three to set the contract"}>
                  <select
                    className={selectClass}
                    aria-label="Call or put"
                    value={rights.includes(pick.right as "CE" | "PE") ? pick.right : ""}
                    disabled={!pick.strike || catalog.length === 0}
                    onChange={(event) => chooseContract(row.id, pick.expiry, pick.strike, event.target.value)}
                  >
                    <option value="">Select</option>
                    {rights.includes("CE") ? <option value="CE">Call</option> : null}
                    {rights.includes("PE") ? <option value="PE">Put</option> : null}
                  </select>
                </Field>
                <Field label="Quantity">
                  <Input value={row.quantity} inputMode="numeric" placeholder="-650" onChange={(event) => updateRow(row.id, { quantity: event.target.value })} />
                </Field>
                <Field label="Average">
                  <Input value={row.average} inputMode="decimal" placeholder="120" onChange={(event) => updateRow(row.id, { average: event.target.value })} />
                </Field>
                <Field label="Current price" hint={quote ? `${quote.source === "mid" ? "Bid/ask mid" : quote.source === "ltp" ? "Last traded price" : "No price"} · ${qualityLabel(quote.quality)}` : "Live Kite quote"}>
                  <Input value={quote?.price != null ? formatNumber(quote.price) : ""} readOnly placeholder="Waiting for Kite" />
                </Field>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex items-center gap-2 pb-2">
                    <Switch
                      checked={row.included}
                      onCheckedChange={(checked) => updateRow(row.id, { included: checked })}
                      aria-label={`Include ${row.symbol || "contract"} in the model`}
                    />
                    <span className="text-xs text-muted-foreground">In model</span>
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeRow(row.id)}>
                    Remove
                  </Button>
                </div>
                {row.symbol && catalog.length > 0 && !listed ? (
                  <p className="text-xs text-muted-foreground md:col-span-6">
                    Saved contract {row.symbol} is not in the current Zerodha list. Choose a listed expiry, strike and call or put to replace it.
                  </p>
                ) : null}
                {quote && quote.price != null ? (
                  <p className="text-xs text-muted-foreground md:col-span-6">
                    Kite {formatNumber(quote.price)} · {quote.source === "mid" ? "bid/ask mid" : quote.source === "ltp" ? "last traded price" : "no price"} · {qualityLabel(quote.quality)}
                    {quote.found && quote.expiry ? ` · expiry ${quote.expiry}` : ""}
                    {quote.lotSize ? ` · lot ${quote.lotSize}` : ""}
                    {!quote.found ? " · not in the instrument master" : ""}
                  </p>
                ) : null}
                {leg?.error ? <p className="text-sm text-rose-700 dark:text-rose-400 md:col-span-6">{leg.error}</p> : null}
                {leg?.note ? <p className="text-xs text-amber-800 dark:text-amber-300 md:col-span-6">{leg.note}</p> : null}
              </div>
            );
          })}
          <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, freshEntry()])}>
            Add contract
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scenario controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="NIFTY moves" hint="Points from the spot you entered">
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
            <select className={selectClass} value={ivMode} onChange={(event) => setIvMode(event.target.value as IvMode)} aria-label="Volatility scenario">
              <option value="constant">Constant IV</option>
              <option value="up">IV up</option>
              <option value="down">IV down</option>
            </select>
          </Field>
          <Field label="IV shift (points)" hint="3 points turns 20% into 23%">
            <Input value={ivPoints} onChange={(event) => setIvPoints(event.target.value)} inputMode="decimal" disabled={ivMode === "constant"} />
          </Field>
          <Field label="Interest rate %" hint="Model input">
            <Input value={ratePct} onChange={(event) => setRatePct(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Dividend yield %">
            <Input value={divPct} onChange={(event) => setDivPct(event.target.value)} inputMode="decimal" />
          </Field>
        </CardContent>
      </Card>

      {!moves ? <p className="rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">Enter 1 to 15 finite moves between -5000 and 5000, separated by commas.</p> : null}
      {model.modelError ? <p className="rounded-md border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">{model.modelError}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="NIFTY spot" value={formatNumber(Number(effectiveSpot) > 0 ? Number(effectiveSpot) : null, 2)} detail={spotText.trim() ? "Entered" : live?.spot.price ? "Kite quote" : "Enter a spot or connect Zerodha"} />
        <Metric
          label="Day's P&L"
          value={formatInr(dayCandidates.length > 0 ? dayBook.total : null)}
          detail={
            !live
              ? "Connect Zerodha to read the previous close"
              : dayCandidates.length === 0
                ? "Add a contract to mark it from the previous close"
                : dayBook.complete
                  ? "Live price versus the previous close"
                  : "Previous close is missing for a contract"
          }
          className={pnlClass(dayBook.total)}
        />
        <Metric label="In model" value={String(modeledPositions.length)} detail={excludedCount > 0 ? `${excludedCount} left out` : "Typed contracts"} />
        <Metric label="Portfolio delta" value={formatNumber(greeks?.delta ?? null, 1)} detail={withScope(greeks && !greeks.complete ? "Partial" : "Model, per point")} />
        <Metric label="Portfolio gamma" value={formatNumber(greeks?.gamma ?? null, 4)} detail={withScope("Per one index point")} />
        <Metric label="Theta / day" value={formatNumber(greeks?.thetaPerDay ?? null)} detail={withScope("Calendar day")} className={pnlClass(greeks?.thetaPerDay)} />
        <Metric label="Vega / point" value={formatNumber(greeks?.vegaPerPoint ?? null)} detail={withScope("Per 1 vol point")} />
      </section>

      {modeledPositions.length > 0 || (model.scenario?.decay.length ?? 0) > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {modeledPositions.length > 0 ? <DirectionMix positions={modeledPositions} greeks={model.scenario?.positionGreeks ?? []} /> : null}
          {model.scenario && model.scenario.decay.length > 0 ? <DecayStrip points={model.scenario.decay} /> : null}
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Priced book</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableCaption>
              Current price is the latest Kite quote. A typed price is not used. Priced {formatIst(model.now.toISOString())}.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Day P&L</TableHead>
                <TableHead className="text-right">IV</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead className="text-right">Gamma</TableHead>
                <TableHead className="text-right">Theta/day</TableHead>
                <TableHead className="text-right">Vega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const leg = legById.get(row.id);
                const greek = model.scenario?.positionGreeks.find((item) => item.id === row.id);
                if (!leg?.tradingSymbol) return null;
                return (
                  <TableRow key={row.id} className={!row.included ? "opacity-50" : undefined}>
                    <TableCell>
                      <div className="font-medium">{leg.tradingSymbol}</div>
                      <div className="text-xs text-muted-foreground">
                        {leg.optionType ?? "—"} {leg.strike ?? "—"} · {leg.expiry ?? "expiry n/a"}
                      </div>
                      {pricingReasons(leg, greek, model.modelError, Number(effectiveSpot) > 0).map((reason) => (
                        <div key={reason} className="mt-1 max-w-xs text-[11px] text-amber-800 dark:text-amber-300">
                          {reason}
                        </div>
                      ))}
                      {dayById.has(row.id) && dayById.get(row.id) == null ? (
                        <div className="mt-1 max-w-xs text-[11px] text-amber-800 dark:text-amber-300">
                          {live ? "The Kite quote has no previous close, so day's P&L is unavailable." : "Connect Zerodha to read the previous close for day's P&L."}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {leg.side ? (
                        <Badge className={leg.side === "long" ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300" : "border-rose-600/40 text-rose-700 dark:text-rose-300"}>
                          {leg.side}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(leg.quantity, 0)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(leg.average)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(leg.price)}</TableCell>
                    <TableCell className={`text-right font-mono tabular ${pnlClass(dayById.get(row.id))}`}>{formatInr(dayById.get(row.id) ?? null)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatPercentPoints(greek?.iv)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(greek?.delta, 2)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(greek?.gamma, 4)}</TableCell>
                    <TableCell className={`text-right font-mono tabular ${pnlClass(greek?.thetaPerDay)}`}>{formatNumber(greek?.thetaPerDay)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{formatNumber(greek?.vegaPerPoint)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {includedScenarioPositions(effectiveRows, model.legs).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Expiry profit and loss</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpiryPayoffChart
              legs={includedScenarioPositions(effectiveRows, model.legs).map((position) => ({
                right: position.right,
                strike: position.strike,
                quantity: position.quantity,
                multiplier: position.multiplier,
                entryPremium: position.entryPremium,
                marketPremium: position.marketPremium,
              }))}
              spot={Number.isFinite(Number(effectiveSpot)) ? Number(effectiveSpot) : null}
            />
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Portfolio scenario P&L</CardTitle>
          </CardHeader>
          <CardContent>
            {model.scenario && model.scenario.rows.length > 0 ? <PortfolioPnlChart scenario={model.scenario} /> : <EmptyChart />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Position contribution</CardTitle>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={selectedFocus}
              onChange={(event) => setFocusMove(Number(event.target.value))}
              aria-label="Contribution scenario"
            >
              {focusChoices.map((move) => (
                <option key={move} value={move}>
                  {move > 0 ? `+${move}` : move}
                </option>
              ))}
            </select>
          </CardHeader>
          <CardContent>
            {model.scenario && model.scenario.rows.length > 0 ? (
              <ContributionChart scenario={model.scenario} move={selectedFocus} />
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
          {model.scenario && model.scenario.rows.length > 0 ? <ScenarioTable scenario={model.scenario} /> : <EmptyChart />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model assumptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{MODEL_DISCLAIMER}</p>
          <p>European Black–Scholes–Merton. IV is calibrated from the live Kite quote.</p>
          <p>Day count is ACT/365. Theta is per calendar day. Vega is per one volatility point.</p>
          <p>{model.scenario?.settlementAssumption}</p>
          <p>Turning off “In model” removes that contract from the totals, the mix, and the scenario. It does not change a brokerage account.</p>
        </CardContent>
      </Card>
    </main>
    </>
  );
}

interface ContractPick {
  expiry: string;
  strike: string;
  right: string;
}

function freshEntry(): ManualEntry {
  return { ...blankEntry(), id: crypto.randomUUID() };
}

function formatExpiryLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function pricingReasons(
  leg: PreparedManualLeg,
  greek: { iv: number | null; warnings: string[] } | undefined,
  modelError: string | null,
  spotReady: boolean,
): string[] {
  const reasons = [leg.error, leg.note].filter((reason): reason is string => Boolean(reason));
  if (!greek || greek.iv == null) reasons.push(...(greek?.warnings ?? []));
  if (leg.position && !greek && !spotReady) reasons.push("NIFTY spot is missing, so IV and Greeks were not calculated.");
  if (leg.position && !greek && spotReady && modelError) reasons.push(modelError);
  return [...new Set(reasons)];
}

function parseMoves(text: string): number[] | null {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 15) return null;
  const moves = parts.map((part) => Number(part.replace("−", "-")));
  if (moves.some((move) => !Number.isFinite(move) || move < -5000 || move > 5000)) return null;
  return moves;
}

function readStoredBook(): StoredBook | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBook;
    if (!parsed || typeof parsed.spot !== "string" || !Array.isArray(parsed.rows)) return null;
    if (typeof parsed.moveText !== "string" || typeof parsed.horizon !== "string" || typeof parsed.customDays !== "string") return null;
    if (typeof parsed.ivPoints !== "string" || typeof parsed.ratePct !== "string" || typeof parsed.divPct !== "string") return null;
    const rows = parsed.rows.filter(isManualEntry);
    if (parsed.ivMode !== "constant" && parsed.ivMode !== "up" && parsed.ivMode !== "down") return null;
    return { ...parsed, rows };
  } catch {
    return null;
  }
}

function isManualEntry(value: unknown): value is ManualEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as ManualEntry;
  return (
    typeof row.id === "string" &&
    typeof row.symbol === "string" &&
    typeof row.quantity === "string" &&
    typeof row.average === "string" &&
    typeof row.price === "string" &&
    typeof row.expiry === "string" &&
    typeof row.included === "boolean"
  );
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

function EmptyChart() {
  return <p className="py-16 text-center text-sm text-muted-foreground">Enter a spot and at least one complete contract to price the book.</p>;
}
