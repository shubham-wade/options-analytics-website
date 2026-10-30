"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatInr, formatNumber, formatRupee, formatSigned, pnlClass } from "@/lib/format";
import { screenerUrl } from "@/lib/stocks/parse";
import type { OpenRow, PaperDesk as Desk, ResearchRow } from "@/lib/paper/view";

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function percent(value: number | null): string {
  if (value == null) return "—";
  return `${formatSigned(value)}%`;
}

export function PaperDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/paper", { cache: "no-store" });
    const body = (await response.json()) as Desk & { error?: string };
    if (!response.ok) {
      setError(body.error ?? "The paper book could not be read.");
      return;
    }
    setDesk(body);
    setError(null);
  }, []);

  useEffect(() => {
    void load().catch(() => setError("The paper book could not be read."));
  }, [load]);

  async function buy(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const typed = price.trim();
      const response = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "buy",
          symbol,
          quantity: Number(quantity),
          price: typed ? Number(typed) : null,
        }),
      });
      const body = (await response.json()) as Desk & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The paper buy could not be saved.");
        return;
      }
      setDesk(body);
      setPrice("");
      setConfirmId(null);
    } catch {
      setError("The paper buy could not be saved.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function sell(id: string) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sell", id }),
      });
      const body = (await response.json()) as Desk & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "The paper sell could not be saved.");
        return;
      }
      setDesk(body);
      setConfirmId(null);
    } catch {
      setError("The paper sell could not be saved.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const summary = desk?.summary;

  return (
    <>
      <LabHeader kicker="Paper book" live={false} refreshing={saving}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Dashboard</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/stocks">Stocks</Link>
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          A buy here is stored on this desk only. It is not sent to Zerodha. Each lot keeps its entry, and the page marks it to the latest NSE print so you can see the result beside how far that price has already moved from its 52-week range.
        </p>
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <Metric label="Open cost" value={formatRupee(summary?.cost ?? null)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Metric label="Market value" value={formatRupee(summary?.marketValue ?? null)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Metric label="Unrealised" value={formatInr(summary?.unrealised ?? null)} className={pnlClass(summary?.unrealised)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <Metric label="Realised" value={formatInr(summary?.realised ?? null)} className={pnlClass(summary?.realised)} />
            </CardContent>
          </Card>
        </div>

        {desk && desk.research.length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2">
            {desk.research.map((row) => (
              <ResearchCard
                key={row.symbol}
                row={row}
                onUse={() => {
                  setSymbol(row.symbol);
                  setError(null);
                }}
              />
            ))}
          </section>
        ) : null}

        <form onSubmit={(event) => void buy(event)} className="flex max-w-3xl flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            NSE symbol
            <Input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="COLPAL"
              aria-label="NSE symbol"
              className="w-32 uppercase"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Shares
            <Input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
              aria-label="Shares"
              className="w-24"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Entry, blank uses the live print
            <Input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="Live print"
              aria-label="Entry price"
              className="w-36"
            />
          </label>
          <Button type="submit" size="sm" disabled={saving || !symbol.trim() || !quantity.trim()}>
            {saving ? "Saving" : "Paper buy"}
          </Button>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Open lots</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {desk && desk.open.length > 0 ? (
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Symbol</th>
                    <th className="py-2 font-medium">Shares</th>
                    <th className="py-2 font-medium">Entry</th>
                    <th className="py-2 font-medium">Last</th>
                    <th className="py-2 font-medium">Since entry</th>
                    <th className="py-2 font-medium">Unrealised</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {desk.open.map((lot) => (
                    <OpenLot
                      key={lot.id}
                      lot={lot}
                      confirming={confirmId === lot.id}
                      disabled={saving}
                      onConfirm={() => setConfirmId(lot.id)}
                      onSell={() => void sell(lot.id)}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">No open paper lots. A buy stays on this desk until you paper-sell it.</p>
            )}
          </CardContent>
        </Card>

        {desk && desk.closed.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Closed lots</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Symbol</th>
                    <th className="py-2 font-medium">Shares</th>
                    <th className="py-2 font-medium">Entry</th>
                    <th className="py-2 font-medium">Exit</th>
                    <th className="py-2 font-medium">Opened</th>
                    <th className="py-2 font-medium">Closed</th>
                    <th className="py-2 font-medium">Realised</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.closed.map((lot) => (
                    <tr key={lot.id} className="border-t">
                      <td className="py-2">{lot.symbol}</td>
                      <td className="py-2 tabular-nums">{formatNumber(lot.quantity, 0)}</td>
                      <td className="py-2 tabular-nums">{formatRupee(lot.entry)}</td>
                      <td className="py-2 tabular-nums">{formatRupee(lot.exit)}</td>
                      <td className="py-2">{lot.openedOn}</td>
                      <td className="py-2">{lot.closedOn}</td>
                      <td className={`py-2 tabular-nums ${pnlClass(lot.realised)}`}>{formatInr(lot.realised)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : null}

        <p className="max-w-3xl text-xs text-muted-foreground">
          Marks use Groww’s NSE cash print, or the latest saved stock file when that print does not load. A blank entry uses the live print. Paper sell closes the whole lot at the live print. Brokerage and taxes are not included. A line about the 52-week range describes the price. It is not a buy or sell call.
        </p>
      </main>
    </>
  );
}

function ResearchCard({ row, onUse }: { row: ResearchRow; onUse: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-3">
          <Link href={`/stocks/${row.symbol}`} className="hover:underline">
            {row.name}
          </Link>
          <span className="text-base font-medium tabular-nums">{formatRupee(row.last)}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {row.symbol}
          {" · "}
          <a href={screenerUrl(row.symbol)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            Screener
          </a>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {row.lines.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={onUse}>
            Use {row.symbol}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OpenLot({
  lot,
  confirming,
  disabled,
  onConfirm,
  onSell,
}: {
  lot: OpenRow;
  confirming: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onSell: () => void;
}) {
  return (
    <tr className="border-t align-top">
      <td className="py-2">
        <Link href={`/stocks/${lot.symbol}`} className="hover:underline">
          {lot.symbol}
        </Link>
        {" · "}
        <a href={screenerUrl(lot.symbol)} target="_blank" rel="noreferrer" className="text-xs underline-offset-2 hover:underline">
          Screener
        </a>
        {lot.name ? <span className="ml-2 text-xs text-muted-foreground">{lot.name}</span> : null}
        <p className="text-xs text-muted-foreground">Opened {lot.openedOn}</p>
        {lot.lines.map((line) => (
          <p key={line} className="mt-1 max-w-xs text-xs text-muted-foreground">
            {line}
          </p>
        ))}
        {lot.markSource === "file" ? <p className="mt-1 text-xs text-muted-foreground">Marked from the saved file.</p> : null}
      </td>
      <td className="py-2 tabular-nums">{formatNumber(lot.quantity, 0)}</td>
      <td className="py-2 tabular-nums">{formatRupee(lot.entry)}</td>
      <td className="py-2 tabular-nums">{formatRupee(lot.last)}</td>
      <td className={`py-2 tabular-nums ${pnlClass(lot.sinceEntry)}`}>{percent(lot.sinceEntry)}</td>
      <td className={`py-2 tabular-nums ${pnlClass(lot.unrealised)}`}>{formatInr(lot.unrealised)}</td>
      <td className="py-2 text-right">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={confirming ? onSell : onConfirm}>
          {confirming ? "Confirm paper sell" : "Paper sell"}
        </Button>
      </td>
    </tr>
  );
}
