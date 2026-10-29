"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInr, formatIst, formatNumber, formatRupee, formatSigned, pnlClass } from "@/lib/format";
import { holdingMoves, holdingSpan } from "@/lib/stocks/parse";
import type { StockChange, StockFile, StockHolding, StockPrice, StockSnapshot } from "@/lib/stocks/types";

interface Payload {
  file: StockFile;
  versusPrevious: StockChange[];
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function holding(value: number | null): string {
  return value == null ? "—" : `${formatNumber(value)}%`;
}

function averageNote(price: StockPrice): string | null {
  if (price.average == null) return null;
  const source = price.averageSource === "kite" ? "Zerodha’s average traded price" : "the volume-weighted price of today’s minute bars";
  if (price.last == null) return `Day average is ${formatRupee(price.average)}, from ${source}.`;
  const delta = price.last - price.average;
  if (Math.abs(delta) < 0.005) return `Last is on the day average of ${formatRupee(price.average)} (${source}).`;
  const side = delta > 0 ? "above" : "below";
  return `Day average is ${formatRupee(price.average)} (${source}). Last is ₹${formatNumber(Math.abs(delta))} ${side} it.`;
}

function ShareCell({ current, previous }: { current: number | null; previous: number | null }) {
  const delta = current != null && previous != null ? current - previous : null;
  const moved = delta != null && Math.abs(delta) >= 0.005;
  return (
    <td className="py-2 tabular-nums">
      {holding(current)}
      {moved ? <span className="ml-2 text-xs text-muted-foreground">{formatSigned(delta)} pp</span> : null}
    </td>
  );
}

export function StockFileView({ symbol }: { symbol: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}`, { cache: "no-store" });
    const body = (await response.json()) as Payload & { error?: string };
    if (!response.ok) {
      setError(body.error ?? "This stock file could not be read.");
      return;
    }
    setPayload(body);
    setError(null);
  }, [symbol]);

  useEffect(() => {
    void load().catch(() => setError("This stock file could not be read."));
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}`, { method: "POST" });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The snapshot could not be saved.");
        return;
      }
      setPayload(body);
    } catch {
      setError("The snapshot could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const file = payload?.file;
  const latest = file?.snapshots[file.snapshots.length - 1];
  const previous = file && file.snapshots.length > 1 ? file.snapshots[file.snapshots.length - 2] : null;
  const pattern = latest?.holdings?.length ? latest.holdings : latest?.holding ? [latest.holding] : [];
  const shareMoves = holdingMoves(pattern);
  const shareSpan = holdingSpan(pattern);
  const averageLine = latest ? averageNote(latest.price) : null;
  const latestHolding = pattern[pattern.length - 1];
  const previousHolding = pattern.length > 1 ? pattern[pattern.length - 2] : null;
  const firstHolding = pattern[0];

  return (
    <>
      <LabHeader kicker="Stock file" live={false} refreshing={saving}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/stocks">All stocks</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/paper">Paper</Link>
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving" : "Save snapshot"}
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        {file && latest ? (
          <>
            <section>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {file.exchange}:{file.symbol}
                {file.industry ? ` · ${file.industry}` : ""}
                {file.isin ? ` · ${file.isin}` : ""}
              </p>
              <h2 className="mt-1 text-2xl font-semibold">{file.name}</h2>
              <p className={`mt-2 text-3xl font-semibold tabular-nums ${pnlClass(latest.price.change)}`}>
                {formatRupee(latest.price.last)}
                <span className="ml-3 text-base font-medium">
                  {formatInr(latest.price.change)} ({formatSigned(latest.price.changePercent)}%)
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Saved {latest.date} · price from {latest.price.source === "kite" ? "Zerodha" : "Groww NSE print"} · {formatIst(latest.savedAt)}
              </p>
              {averageLine ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{averageLine}</p> : null}
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Since the previous saved reading</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {previous && payload.versusPrevious.length > 0 ? (
                  payload.versusPrevious.map((change) => <p key={change.label}>{change.text}</p>)
                ) : previous ? (
                  <p>The saved figures match the {previous.date} reading.</p>
                ) : (
                  <p>This is the first saved reading. The next day’s snapshot will show what moved. A higher price or a lower P/E is a change in the figures, not a decision to buy or sell.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Price</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric label="Open" value={formatRupee(latest.price.open)} />
                <Metric label="High" value={formatRupee(latest.price.high)} />
                <Metric label="Low" value={formatRupee(latest.price.low)} />
                <Metric label="Previous close" value={formatRupee(latest.price.previousClose)} />
                <Metric label="Day average" value={formatRupee(latest.price.average)} />
                <Metric label="Volume" value={latest.price.volume == null ? "—" : formatNumber(latest.price.volume, 0)} />
                <Metric label="52-week high" value={formatRupee(latest.price.yearHigh)} />
                <Metric label="52-week low" value={formatRupee(latest.price.yearLow)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Valuation</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric
                  label="Market cap"
                  value={
                    latest.fundamentals.marketCapCrore == null
                      ? "—"
                      : `₹${formatNumber(latest.fundamentals.marketCapCrore, 0)} Cr`
                  }
                />
                <Metric label="P/E" value={formatNumber(latest.fundamentals.pe)} />
                <Metric label="Industry P/E" value={formatNumber(latest.fundamentals.industryPe)} />
                <Metric label="EPS" value={formatRupee(latest.fundamentals.eps)} />
                <Metric label="P/B" value={formatNumber(latest.fundamentals.pb)} />
                <Metric label="ROE" value={latest.fundamentals.roe == null ? "—" : `${formatNumber(latest.fundamentals.roe)}%`} />
                <Metric label="Debt to equity" value={formatNumber(latest.fundamentals.debtToEquity)} />
                <Metric label="Book value" value={formatRupee(latest.fundamentals.bookValue)} />
                <Metric label="Dividend yield" value={latest.fundamentals.dividendYield == null ? "—" : `${formatNumber(latest.fundamentals.dividendYield)}%`} />
                <Metric label="Face value" value={formatRupee(latest.fundamentals.faceValue)} />
              </CardContent>
            </Card>

            {pattern.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Shareholding</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {shareMoves.length > 0 && previousHolding && latestHolding ? (
                    <div className="space-y-2 text-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Since the last published quarter · {previousHolding.quarter} to {latestHolding.quarter}
                      </p>
                      {shareMoves.map((change) => (
                        <p key={`latest-${change.label}`}>{change.text}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Only one published quarter is on file, so there is no earlier quarter to compare.</p>
                  )}
                  {shareSpan.length > 0 && firstHolding && latestHolding && firstHolding.quarter !== previousHolding?.quarter ? (
                    <div className="space-y-2 text-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Across this file · {firstHolding.quarter} to {latestHolding.quarter}
                      </p>
                      {shareSpan.map((change) => (
                        <p key={`span-${change.label}`}>{change.text}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-2 font-medium">Quarter</th>
                          <th className="py-2 font-medium">Promoter</th>
                          <th className="py-2 font-medium">Foreign institutions</th>
                          <th className="py-2 font-medium">Mutual funds</th>
                          <th className="py-2 font-medium">Insurance</th>
                          <th className="py-2 font-medium">Retail and others</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pattern.map((row, index) => (
                          <ShareRow key={row.quarter} row={row} previous={index > 0 ? pattern[index - 1] : null} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{latest.accounts === "standalone" ? "Standalone" : "Consolidated"} results · ₹ crore</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">Year</th>
                      <th className="py-2 font-medium">Revenue</th>
                      <th className="py-2 font-medium">Profit</th>
                      <th className="py-2 font-medium">Net worth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.years.map((year) => (
                      <tr key={year.year} className="border-t">
                        <td className="py-2">{year.year}</td>
                        <td className="py-2 tabular-nums">{formatNumber(year.revenue, 0)}</td>
                        <td className={`py-2 tabular-nums ${pnlClass(year.profit)}`}>{formatNumber(year.profit, 0)}</td>
                        <td className={`py-2 tabular-nums ${pnlClass(year.netWorth)}`}>{formatNumber(year.netWorth, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {latest.quarters.length > 0 ? (
                  <table className="mt-6 w-full min-w-[28rem] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-2 font-medium">Quarter</th>
                        <th className="py-2 font-medium">Revenue</th>
                        <th className="py-2 font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.quarters.map((quarter) => (
                        <tr key={quarter.quarter} className="border-t">
                          <td className="py-2">{quarter.quarter}</td>
                          <td className="py-2 tabular-nums">{formatNumber(quarter.revenue, 0)}</td>
                          <td className={`py-2 tabular-nums ${pnlClass(quarter.profit)}`}>{formatNumber(quarter.profit, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </CardContent>
            </Card>

            {file.snapshots.length > 1 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Saved readings</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-2 font-medium">Date</th>
                        <th className="py-2 font-medium">Price</th>
                        <th className="py-2 font-medium">P/E</th>
                        <th className="py-2 font-medium">ROE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...file.snapshots].reverse().map((row) => (
                        <Reading key={row.date} row={row} />
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}

            <p className="max-w-3xl text-xs text-muted-foreground">
              Price, volume, and the day’s range come from Groww’s NSE cash print, or from your Zerodha login when that quote is available. The day average is Zerodha’s average traded price when that login is present, and otherwise the volume-weighted price of today’s minute bars. Market cap, P/E, ROE, shareholding, and results come from Groww’s company page. The shareholding lines compare the latest published quarter with the one before it, and the earliest quarter on this file. Zerodha’s quote does not include P/E, results, or shareholding.
            </p>
          </>
        ) : null}
      </main>
    </>
  );
}

function ShareRow({ row, previous }: { row: StockHolding; previous: StockHolding | null }) {
  return (
    <tr className="border-t">
      <td className="py-2">{row.quarter}</td>
      <ShareCell current={row.promoter} previous={previous?.promoter ?? null} />
      <ShareCell current={row.foreignInstitutions} previous={previous?.foreignInstitutions ?? null} />
      <ShareCell current={row.mutualFunds} previous={previous?.mutualFunds ?? null} />
      <ShareCell current={row.insurance} previous={previous?.insurance ?? null} />
      <ShareCell current={row.retailAndOthers} previous={previous?.retailAndOthers ?? null} />
    </tr>
  );
}

function Reading({ row }: { row: StockSnapshot }) {
  return (
    <tr className="border-t">
      <td className="py-2">{row.date}</td>
      <td className="py-2 tabular-nums">{formatRupee(row.price.last)}</td>
      <td className="py-2 tabular-nums">{formatNumber(row.fundamentals.pe)}</td>
      <td className="py-2 tabular-nums">{row.fundamentals.roe == null ? "—" : `${formatNumber(row.fundamentals.roe)}%`}</td>
    </tr>
  );
}
