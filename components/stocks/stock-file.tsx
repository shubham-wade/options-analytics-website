"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInr, formatIst, formatNumber, formatRupee, formatSigned, pnlClass } from "@/lib/format";
import { StockHighlightPicker } from "@/components/stocks/stock-highlight";
import { highlightFrameClass, highlightToneStyle, holdingMoves, holdingSpan, screenerUrl, STOCK_COMMENT_MAX } from "@/lib/stocks/parse";
import { netMargin } from "@/lib/stocks/reading";
import { cn } from "@/lib/utils";
import type { StockChange, StockFile, StockHighlight, StockHolding, StockPrice, StockSnapshot } from "@/lib/stocks/types";

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

function dayLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function marginLabel(profit: number | null, revenue: number | null): string {
  const margin = netMargin(profit, revenue);
  return margin == null ? "—" : `${formatNumber(margin, 1)}%`;
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
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState("");
  const [commentStatus, setCommentStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedComment = useRef("");
  const loadedSymbol = useRef<string | null>(null);
  const commentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    loadedSymbol.current = null;
    savedComment.current = "";
    setDraft("");
    setCommentStatus("idle");
  }, [symbol]);

  useEffect(() => {
    if (!payload?.file) return;
    if (loadedSymbol.current === payload.file.symbol) return;
    loadedSymbol.current = payload.file.symbol;
    savedComment.current = payload.file.comment ?? "";
    setDraft(payload.file.comment ?? "");
  }, [payload]);

  function queueComment(next: string) {
    setDraft(next);
    setCommentStatus("idle");
    if (commentTimer.current) clearTimeout(commentTimer.current);
    commentTimer.current = setTimeout(() => {
      void persistComment(next);
    }, 700);
  }

  async function save() {
    if (commentTimer.current) clearTimeout(commentTimer.current);
    await persistComment(draft);
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

  async function drop() {
    if (!pendingRemove) {
      setPendingRemove(true);
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "This stock could not be removed.");
        return;
      }
      router.push("/stocks");
    } catch {
      setError("This stock could not be removed.");
    } finally {
      setRemoving(false);
    }
  }

  useEffect(
    () => () => {
      if (commentTimer.current) clearTimeout(commentTimer.current);
    },
    [],
  );

  async function persistComment(text: string) {
    if (text === savedComment.current) return;
    setCommentStatus("saving");
    setError(null);
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: text }),
      });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        setCommentStatus("idle");
        setError(body.error ?? "The comment could not be saved.");
        return;
      }
      savedComment.current = text;
      setPayload(body);
      setCommentStatus("saved");
    } catch {
      setCommentStatus("idle");
      setError("The comment could not be saved.");
    }
  }

  async function mark(next: StockHighlight) {
    setMarking(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(symbol)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlight: next }),
      });
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The highlight could not be saved.");
        return;
      }
      setPayload(body);
    } catch {
      setError("The highlight could not be saved.");
    } finally {
      setMarking(false);
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
        <Button size="sm" variant="outline" disabled={saving || removing} onClick={() => void save()}>
          {saving ? "Saving" : "Save snapshot"}
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        {file && latest ? (
          <div
            className={cn(
              "flex flex-col gap-6 rounded-xl border-2 p-4 transition-[border-color,box-shadow] duration-500 md:p-6",
              highlightFrameClass(file.highlight),
            )}
            style={highlightToneStyle(file.highlight) as CSSProperties}
          >
            <section className="flex items-start justify-between gap-4">
              <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {file.exchange}:{file.symbol}
                {file.industry ? ` · ${file.industry}` : ""}
                {file.isin ? ` · ${file.isin}` : ""}
                {" · "}
                <a href={screenerUrl(file.symbol)} target="_blank" rel="noreferrer" className="normal-case tracking-normal underline-offset-2 hover:underline">
                  Screener
                </a>
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
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StockHighlightPicker value={file.highlight} disabled={marking || removing} onChange={(next) => void mark(next)} />
                {pendingRemove ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-700 dark:text-rose-400"
                      disabled={saving || removing}
                      onClick={() => void drop()}
                    >
                      {removing ? "Removing" : "Confirm remove"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={saving || removing} onClick={() => setPendingRemove(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void drop()}>
                    Remove
                  </Button>
                )}
              </div>
            </section>

            {latest.notes && latest.notes.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Reading</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {latest.notes.map((note) => (
                    <p key={note.heading}>
                      <span className="font-medium">{note.heading}. </span>
                      {note.text}
                    </p>
                  ))}
                  <p className="text-xs text-muted-foreground">These sentences restate the figures on this file. They are not a buy or sell call.</p>
                </CardContent>
              </Card>
            ) : null}

            {latest.profile?.businessSummary ? (
              <Card>
                <CardHeader>
                  <CardTitle>Company text</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {latest.profile.foundedYear != null ? (
                    <p className="text-xs text-muted-foreground">Founded {latest.profile.foundedYear}</p>
                  ) : null}
                  <p>{latest.profile.businessSummary}</p>
                </CardContent>
              </Card>
            ) : null}

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
                <Metric label="Median P/E" value={formatNumber(file?.pe?.median ?? null)} />
                <Metric label="All-time high P/E" value={formatNumber(file?.pe?.high ?? null)} />
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
                      <th className="py-2 font-medium">Net margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.years.map((year) => (
                      <tr key={year.year} className="border-t">
                        <td className="py-2">{year.year}</td>
                        <td className="py-2 tabular-nums">{formatNumber(year.revenue, 0)}</td>
                        <td className={`py-2 tabular-nums ${pnlClass(year.profit)}`}>{formatNumber(year.profit, 0)}</td>
                        <td className={`py-2 tabular-nums ${pnlClass(year.netWorth)}`}>{formatNumber(year.netWorth, 0)}</td>
                        <td className="py-2 tabular-nums">{marginLabel(year.profit, year.revenue)}</td>
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
                        <th className="py-2 font-medium">Net margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.quarters.map((quarter) => (
                        <tr key={quarter.quarter} className="border-t">
                          <td className="py-2">{quarter.quarter}</td>
                          <td className="py-2 tabular-nums">{formatNumber(quarter.revenue, 0)}</td>
                          <td className={`py-2 tabular-nums ${pnlClass(quarter.profit)}`}>{formatNumber(quarter.profit, 0)}</td>
                          <td className="py-2 tabular-nums">{marginLabel(quarter.profit, quarter.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </CardContent>
            </Card>

            {latest.peers && latest.peers.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Peers</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-2 font-medium">Symbol</th>
                        <th className="py-2 font-medium">Name</th>
                        <th className="py-2 font-medium">Market cap</th>
                        <th className="py-2 font-medium">P/E</th>
                        <th className="py-2 font-medium">P/B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...latest.peers]
                        .sort((a, b) => (b.marketCapCrore ?? 0) - (a.marketCapCrore ?? 0))
                        .map((peer) => (
                          <tr key={peer.symbol} className="border-t">
                            <td className="py-2">
                              <a href={screenerUrl(peer.symbol)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                                {peer.symbol}
                              </a>
                            </td>
                            <td className="py-2">{peer.name}</td>
                            <td className="py-2 tabular-nums">{peer.marketCapCrore == null ? "—" : `₹${formatNumber(peer.marketCapCrore, 0)} Cr`}</td>
                            <td className="py-2 tabular-nums">{formatNumber(peer.pe)}</td>
                            <td className="py-2 tabular-nums">{formatNumber(peer.pb)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}

            {latest.dividends && latest.dividends.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Dividends</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-2 font-medium">Ex date</th>
                        <th className="py-2 font-medium">Amount</th>
                        <th className="py-2 font-medium">Kind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.dividends.map((dividend) => (
                        <tr key={dividend.exDate} className="border-t">
                          <td className="py-2">{dayLabel(dividend.exDate)}</td>
                          <td className="py-2 tabular-nums">{formatRupee(dividend.amount)}</td>
                          <td className="py-2">{dividend.kind ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}

            {latest.news && latest.news.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Headlines</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {latest.news.map((item) => (
                    <p key={`${item.publishedAt}-${item.source}`}>
                      <span className="text-xs text-muted-foreground">
                        {item.source} · {formatIst(item.publishedAt)}
                      </span>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 block underline-offset-2 hover:underline">
                          {item.title}
                        </a>
                      ) : (
                        <span className="mt-1 block">{item.title}</span>
                      )}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ) : null}

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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>Comments</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {commentStatus === "saving" ? "Saving" : commentStatus === "saved" ? "Saved" : `${draft.length}/${STOCK_COMMENT_MAX}`}
                </p>
              </CardHeader>
              <CardContent>
                <Label htmlFor="stock-comment" className="sr-only">
                  Comments
                </Label>
                <Textarea
                  id="stock-comment"
                  value={draft}
                  maxLength={STOCK_COMMENT_MAX}
                  disabled={removing}
                  placeholder="Notes for this file. They stay when you save a new snapshot."
                  onChange={(event) => queueComment(event.target.value)}
                  onBlur={() => {
                    if (commentTimer.current) clearTimeout(commentTimer.current);
                    void persistComment(draft);
                  }}
                />
              </CardContent>
            </Card>

            <p className="max-w-3xl text-xs text-muted-foreground">
              Price, volume, and the day’s range come from Groww’s NSE cash print, or from your Zerodha login when that quote is available. The day average is Zerodha’s average traded price when that login is present, and otherwise the volume-weighted price of today’s minute bars. Market cap, current P/E, ROE, shareholding, results, the company description, growth rates, and the peer list come from Groww’s company JSON. Median and all-time high P/E are trailing P/E from listed history: quarterly EPS from TickerTape and weekly closes from Yahoo. Headlines, dividend ex-dates, and results dates come from the Groww stock page. Net margin is profit divided by revenue. The reading restates those figures. Zerodha’s quote does not include P/E, results, or shareholding.
            </p>
          </div>
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
