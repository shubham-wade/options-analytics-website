"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/dashboard/section";
import type { PayoffLevel } from "@/components/dashboard/payoff-chart";
import { formatNumber, formatSigned, pnlClass } from "@/lib/format";
import { flowLabel } from "@/lib/flows/fii-dii";
import type { NiftyFutureQuote } from "@/lib/kite/portfolio";
import type { MarketBrief } from "@/lib/report/brief";

export function useMarketBrief(): MarketBrief | null {
  const [brief, setBrief] = useState<MarketBrief | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/market-brief", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { brief?: MarketBrief | null };
        if (!cancelled) setBrief(body.brief ?? null);
      } catch {
        if (!cancelled) setBrief(null);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return brief;
}

export function oiLevels(brief: MarketBrief | null): PayoffLevel[] {
  if (!brief?.oi) return [];
  return [
    { strike: brief.oi.callStrike, label: `Call OI ${formatNumber(brief.oi.callStrike, 0)}` },
    { strike: brief.oi.putStrike, label: `Put OI ${formatNumber(brief.oi.putStrike, 0)}` },
  ];
}

export function MarketContext({ brief, future }: { brief: MarketBrief | null; future?: NiftyFutureQuote | null }) {
  const hasBooks = brief?.books.some((book) => book.longChange != null || book.shortChange != null) ?? false;
  const hasMovers = (brief?.pullers.length ?? 0) > 0 || (brief?.draggers.length ?? 0) > 0;
  return (
    <Section title="Session context" aside={brief ? flowLabel(brief.asOf) : undefined}>
      {future?.premium != null ? (
        <p className="mb-4 text-sm">
          {future.symbol} is{" "}
          <span className={`font-mono tabular ${pnlClass(future.premium)}`}>{formatSigned(future.premium, 2)}</span>
          {" "}points versus NIFTY 50.
        </p>
      ) : null}
      {!brief ? <p className="text-sm text-muted-foreground">The latest session has not been saved yet.</p> : null}
      {brief && !hasBooks && !hasMovers ? (
        <p className="text-sm text-muted-foreground">Participant futures and stock points are not in this session&apos;s file.</p>
      ) : null}
      {brief && (hasBooks || hasMovers) ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Index futures, change in contracts</h3>
            <p className="mt-1 text-xs text-muted-foreground">Versus the previous participant file. A change in contracts is not a cash-market net.</p>
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-medium">Book</th>
                  <th className="py-1 text-right font-medium">Long</th>
                  <th className="py-1 text-right font-medium">Short</th>
                </tr>
              </thead>
              <tbody>
                {brief.books.map((book) => (
                  <tr key={book.name} className="border-t border-border">
                    <td className="py-1.5">{book.name}</td>
                    <td className={`py-1.5 text-right font-mono tabular ${pnlClass(book.longChange)}`}>{formatSigned(book.longChange, 0)}</td>
                    <td className={`py-1.5 text-right font-mono tabular ${pnlClass(book.shortChange)}`}>{formatSigned(book.shortChange, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {brief.futuresReading ? <p className="mt-3 text-xs text-muted-foreground">{brief.futuresReading}</p> : null}
          </div>
          <div>
            <h3 className="text-sm font-medium">Point contribution</h3>
            <p className="mt-1 text-xs text-muted-foreground">Top three pullers and draggers of the NIFTY move, in index points.</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <MoverList title="Pullers" rows={brief.pullers} />
              <MoverList title="Draggers" rows={brief.draggers} />
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function MoverList({ title, rows }: { title: string; rows: { symbol: string; points: number }[] }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{title}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.length === 0 ? <li className="text-muted-foreground">None</li> : null}
        {rows.map((row) => (
          <li key={row.symbol} className="flex justify-between gap-3">
            <span>{row.symbol}</span>
            <span className={`font-mono tabular ${pnlClass(row.points)}`}>{formatSigned(row.points, 2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
