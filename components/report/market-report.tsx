"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCrore, formatInr, formatIst, formatNumber, formatSigned, pnlClass } from "@/lib/format";
import { flowLabel } from "@/lib/flows/fii-dii";
import type { CashSession, IndexContributor, IndexPrint, MarketReport, ParticipantRow } from "@/lib/report/types";

type ReportResponse = MarketReport & { sessions?: string[]; latest?: string; error?: string };

export function MarketReportView() {
  const [report, setReport] = useState<MarketReport | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selected = useRef<string | null>(null);
  const latestRef = useRef<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (refresh: boolean, date?: string | null) => {
    const id = ++requestId.current;
    const chosen = date === undefined ? selected.current : date;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (chosen) params.set("date", chosen);
      if (refresh) params.set("refresh", "1");
      const query = params.toString();
      const response = await fetch(query ? `/api/report?${query}` : "/api/report");
      const body = (await response.json()) as ReportResponse;
      if (id !== requestId.current) return;
      if (!response.ok) throw new Error(body.error ?? "The report could not be loaded.");
      selected.current = body.asOf;
      latestRef.current = body.latest ?? body.asOf;
      setReport(body);
      setSessions(body.sessions ?? []);
      setLatest(body.latest ?? body.asOf);
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : "The report could not be loaded.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false, null);
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      const onLatest = !selected.current || selected.current === latestRef.current;
      if (onLatest) void load(false);
      else void fetch("/api/report/sync");
    };
    const timer = window.setInterval(tick, 30 * 60 * 1000);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return (
    <>
      <LabHeader kicker="Post-market · IST" live={false}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Dashboard</Link>
        </Button>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
          {loading ? "Building" : "Refresh"}
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <nav aria-label="Report dates" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:w-48 lg:shrink-0 lg:overflow-y-auto">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Sessions</p>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {sessions.map((date) => {
                const active = report?.asOf === date;
                return (
                  <button
                    key={date}
                    type="button"
                    aria-current={active ? "date" : undefined}
                    disabled={loading && active}
                    onClick={() => void load(false, date)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-left text-sm lg:w-full ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {flowLabel(date)} {date.slice(0, 4)}
                  </button>
                );
              })}
            </div>
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Daily market intelligence</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {report ? `${flowLabel(report.asOf)} ${report.asOf.slice(0, 4)} · built ${formatIst(report.generatedAt)}` : "Opening the latest session."}
                {" "}The session is saved after 16:00 IST. If this machine is off then, it is fetched the next time the site is open. Facts are shown first. Readings of positioning are marked as inference.
              </p>
            </div>
            {error ? <p className="rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-sm">{error}</p> : null}
            {report ? <ReportBody report={report} latest={latest} /> : loading ? <p className="text-sm text-muted-foreground">Collecting the session’s files…</p> : null}
          </div>
        </div>
      </main>
    </>
  );
}

function ReportBody({ report, latest }: { report: MarketReport; latest: string | null }) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <IndexCard print={report.nifty} />
        <IndexCard print={report.bankNifty} />
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">India VIX</CardTitle></CardHeader>
          <CardContent>
            <p className={`font-mono text-2xl ${pnlClass(report.vix ? -report.vix.change : null)}`}>{report.vix ? formatNumber(report.vix.close) : "—"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{report.vix ? `${formatSigned(report.vix.change)} · ${formatSigned(report.vix.percentChange)}% · ${report.vix.regime}` : "Not available"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">FII / DII cash</CardTitle></CardHeader>
          <CardContent>
            <CashLines session={report.cash.today} pending={latest == null || report.asOf === latest} />
          </CardContent>
        </Card>
      </section>

      <SectionBlock title="1. What happened today?">
        {report.nifty ? <PriceStory print={report.nifty} /> : <p className="text-sm text-muted-foreground">NIFTY prices were not available.</p>}
        {report.bankNifty ? <PriceStory print={report.bankNifty} /> : null}
        {report.contributors ? <ContributorTables contribution={report.contributors} indexChange={report.nifty?.change ?? null} /> : null}
        {report.nifty?.advances != null ? (
          <p className="text-sm">NIFTY 50 breadth: {report.nifty.advances} advances, {report.nifty.declines ?? "—"} declines{report.nifty.unchanged != null ? `, ${report.nifty.unchanged} unchanged` : ""}. This is the index’s own constituents, not the full market.</p>
        ) : null}
        {report.sectors.length > 0 ? (
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {report.sectors.map((sector) => (
              <li key={sector.name} className="flex items-center justify-between gap-3 text-sm">
                <span>{sector.name.replace("NIFTY ", "")}</span>
                <span className={`font-mono ${pnlClass(sector.percentChange)}`}>{formatSigned(sector.percentChange)}%</span>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionBlock>

      <SectionBlock title="2. What did institutions do?">
        {report.cash.today ? (
          <p className="text-sm">
            Cash market, provisional. FII {formatCrore(report.cash.today.fii)}, DII {formatCrore(report.cash.today.dii)}, combined {formatCrore(report.cash.today.combined)}.
            {report.cash.fiveDay ? ` Last ${report.cash.fiveDay.sessions} saved sessions: FII ${formatCrore(report.cash.fiveDay.fii)}, DII ${formatCrore(report.cash.fiveDay.dii)}.` : ""}
            {report.cash.month ? ` ${report.cash.month.label}: FII ${formatCrore(report.cash.month.fii)}, DII ${formatCrore(report.cash.month.dii)} across ${report.cash.month.sessions} saved sessions.` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {latest == null || report.asOf === latest
              ? "Cash flow for this date is not saved yet. It often appears between 5:30 and 6:30 PM IST."
              : "Cash flow for this date is not in the saved file."}
          </p>
        )}
        {report.participants.length > 0 ? <ParticipantTable rows={report.participants} asOf={report.participantAsOf} previous={report.participantPrevious} /> : null}
        {report.futures ? (
          <p className="text-sm">
            Index-futures open interest is {formatNumber(report.futures.oi, 0)} contracts
            {report.futures.oiChange != null ? `, ${formatSigned(report.futures.oiChange, 0)} from the previous file` : ""}.
            {" "}<span className="text-muted-foreground">Inferred: {report.futures.reading}</span>
          </p>
        ) : null}
      </SectionBlock>

      <SectionBlock title="3. What does the options market indicate?">
        {report.chains.length === 0 ? <p className="text-sm text-muted-foreground">The option chain did not load.</p> : report.chains.map((chain) => (
          <div key={chain.expiry} className="space-y-2">
            <p className="text-sm font-medium">{chain.expiry}</p>
            <p className="text-sm">
              Call OI {formatNumber(chain.callOi, 0)} ({formatSigned(chain.callOiChange, 0)}). Put OI {formatNumber(chain.putOi, 0)} ({formatSigned(chain.putOiChange, 0)}).
              PCR {chain.pcr == null ? "—" : formatNumber(chain.pcr)} using put open interest divided by call open interest.
              {chain.atmStrike != null ? ` ATM strike ${formatNumber(chain.atmStrike, 0)}, ATM IV ${chain.atmIv == null ? "—" : `${formatNumber(chain.atmIv)}%`}.` : ""}
              {chain.lowerPutIv != null || chain.upperCallIv != null ? ` IV near 2% below spot (put) ${chain.lowerPutIv == null ? "—" : formatNumber(chain.lowerPutIv)}%, near 2% above (call) ${chain.upperCallIv == null ? "—" : formatNumber(chain.upperCallIv)}%.` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              Largest call OI: {chain.topCalls.map((row) => `${formatNumber(row.strike, 0)} (${formatNumber(row.oi, 0)}, ${formatSigned(row.change, 0)})`).join(", ") || "—"}.
              {" "}Largest put OI: {chain.topPuts.map((row) => `${formatNumber(row.strike, 0)} (${formatNumber(row.oi, 0)}, ${formatSigned(row.change, 0)})`).join(", ") || "—"}.
            </p>
          </div>
        ))}
        {report.volatility?.daily != null ? <p className="text-sm text-muted-foreground">{report.volatility.note} Today’s figure is {formatNumber(report.volatility.daily, 5)}.</p> : null}
      </SectionBlock>

      <SectionBlock title="4. What does it mean for the next session?">
        <Evidence title="Supportive evidence" items={report.evidence.supportive} />
        <Evidence title="Adverse evidence" items={report.evidence.adverse} />
        <Evidence title="Inference, not a forecast" items={report.evidence.inferred} />
        <p className="text-sm text-muted-foreground">No single figure here, including FII and DII flow, is a prediction of the next session.</p>
      </SectionBlock>

      <SectionBlock title="5. What could hurt the book?">
        {latest && report.asOf !== latest ? (
          <p className="text-sm text-muted-foreground">Portfolio stress is on the latest session, because the book is the current one.</p>
        ) : report.portfolio ? <PortfolioBlock report={report.portfolio} /> : <p className="text-sm text-muted-foreground">Zerodha is not connected, so portfolio Greeks and scenario P&L are not in this copy. Connect on the dashboard and refresh.</p>}
      </SectionBlock>

      {report.gaps.length > 0 ? (
        <SectionBlock title="Missing from this copy">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {report.gaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </SectionBlock>
      ) : null}

      <SectionBlock title="Sources">
        <ul className="space-y-1 text-sm text-muted-foreground">
          {report.sources.map((source) => <li key={source.name}><span className="text-foreground">{source.name}.</span> {source.detail}</li>)}
        </ul>
      </SectionBlock>
    </>
  );
}

function IndexCard({ print }: { print: IndexPrint | null }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">{print?.name ?? "Index"}</CardTitle></CardHeader>
      <CardContent>
        <p className={`font-mono text-2xl ${pnlClass(print?.change)}`}>{print ? formatNumber(print.close) : "—"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{print ? `${formatSigned(print.change)} · ${formatSigned(print.percentChange)}%` : "Not available"}</p>
      </CardContent>
    </Card>
  );
}

function CashLines({ session, pending }: { session: CashSession | null; pending: boolean }) {
  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        {pending ? "Not saved yet. It often appears between 5:30 and 6:30 PM IST." : "Not in the saved file."}
      </p>
    );
  }
  return (
    <div className="space-y-1 font-mono text-sm">
      <p className={pnlClass(session.fii)}>FII {formatCrore(session.fii)}</p>
      <p className={pnlClass(session.dii)}>DII {formatCrore(session.dii)}</p>
      <p className={pnlClass(session.combined)}>Net {formatCrore(session.combined)}</p>
    </div>
  );
}

function ContributorTables({ contribution, indexChange }: { contribution: NonNullable<MarketReport["contributors"]>; indexChange: number | null }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Point contribution is each stock’s free-float weight at the previous close times today’s price change. The 50 estimates add to {formatSigned(contribution.points)}
        {indexChange == null ? "." : ` of the index move of ${formatSigned(indexChange)}.`}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ContributorList title="Top pullers" rows={contribution.pullers} />
        <ContributorList title="Top draggers" rows={contribution.draggers} />
      </div>
    </div>
  );
}

function ContributorList({ title, rows }: { title: string; rows: IndexContributor[] }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 font-medium">Stock</th>
            <th className="py-1 pr-2 font-medium">Weight</th>
            <th className="py-1 pr-2 font-medium">Move</th>
            <th className="py-1 font-medium">Points</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((row) => (
            <tr key={row.symbol} className="border-t border-border/70">
              <td className="py-1 pr-2 font-sans">{row.symbol}</td>
              <td className="py-1 pr-2">{formatNumber(row.weight)}%</td>
              <td className={`py-1 pr-2 ${pnlClass(row.percentChange)}`}>{formatSigned(row.percentChange)}%</td>
              <td className={`py-1 ${pnlClass(row.points)}`}>{formatSigned(row.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriceStory({ print }: { print: IndexPrint }) {
  const location = print.closingLocation == null ? "The day’s range was flat." : print.closingLocation >= 0.66 ? "The close was in the top third of the range." : print.closingLocation <= 0.34 ? "The close was in the bottom third of the range." : "The close was near the middle of the range.";
  const gap = print.gap == null || Math.abs(print.gap) < 1 ? "It opened almost on the previous close." : print.gap > 0 ? `It opened ${formatNumber(print.gap)} above the previous close.` : `It opened ${formatNumber(Math.abs(print.gap))} below the previous close.`;
  return (
    <p className="text-sm">
      {print.name} opened {formatNumber(print.open)}, ranged {formatNumber(print.low)}–{formatNumber(print.high)}, and closed {formatNumber(print.close)} ({formatSigned(print.change)}, {formatSigned(print.percentChange)}%). {gap} {location} The range location is arithmetic, not a traded level.
    </p>
  );
}

function ParticipantTable({ rows, asOf, previous }: { rows: ParticipantRow[]; asOf: string | null; previous: string | null }) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-xs text-muted-foreground">Index futures contracts{asOf ? ` as of ${asOf}` : ""}{previous ? `, change versus ${previous}` : ""}. Long ratio is long divided by long plus short.</p>
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">Side</th>
            <th className="py-1 pr-3 font-medium">Long</th>
            <th className="py-1 pr-3 font-medium">Short</th>
            <th className="py-1 pr-3 font-medium">Long change</th>
            <th className="py-1 font-medium">Long ratio</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-border/70">
              <td className="py-1.5 pr-3 font-sans">{row.name}</td>
              <td className="py-1.5 pr-3">{formatNumber(row.futureIndexLong, 0)}</td>
              <td className="py-1.5 pr-3">{formatNumber(row.futureIndexShort, 0)}</td>
              <td className={`py-1.5 pr-3 ${pnlClass(row.futureIndexLongChange)}`}>{formatSigned(row.futureIndexLongChange, 0)}</td>
              <td className="py-1.5">{row.longRatio == null ? "—" : `${formatNumber(row.longRatio * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Evidence({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">None from the figures that loaded.</p> : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function PortfolioBlock({ report }: { report: NonNullable<MarketReport["portfolio"]> }) {
  return (
    <div className="space-y-3 text-sm">
      <p>Delta {formatNumber(report.delta, 1)} · gamma {formatNumber(report.gamma, 4)} · theta/day {formatInr(report.thetaPerDay)} · vega per vol point {formatInr(report.vegaPerPoint)}.</p>
      <p>Scenario P&L if NIFTY moves and IV stays unchanged: {report.scenarios.map((point) => `${point.move > 0 ? "+" : ""}${point.move} ${formatInr(point.pnl)}`).join(" · ")}.</p>
      <p>At an unchanged spot, IV up {report.ivPoints} points is {formatInr(report.ivUpPnl)}. IV down {report.ivPoints} points is {formatInr(report.ivDownPnl)}. That is a model reprice, not a forecast.</p>
      {report.byExpiry.length > 0 ? <p>Contracts by expiry: {report.byExpiry.map((row) => `${row.expiry} ${formatSigned(row.contracts, 0)}`).join(" · ")}.</p> : null}
      {report.largest.length > 0 ? (
        <p>Largest absolute delta: {report.largest.map((row) => `${row.symbol} ${formatNumber(row.delta, 1)}`).join(" · ")}.</p>
      ) : null}
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card px-4 py-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}
