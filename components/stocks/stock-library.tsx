"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber, formatRupee, pnlClass } from "@/lib/format";
import type { StockSummary } from "@/lib/stocks/types";

export function StockLibrary() {
  const router = useRouter();
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/stocks", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { stocks?: StockSummary[] }) => setStocks(body.stocks ?? []))
      .catch(() => setError("The saved stock files could not be read."));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = symbol.trim().toUpperCase();
    if (!next) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: next }),
      });
      const body = (await response.json()) as { error?: string; file?: { symbol: string } };
      if (!response.ok || !body.file) {
        setError(body.error ?? "That symbol could not be saved.");
        return;
      }
      router.push(`/stocks/${body.file.symbol}`);
    } catch {
      setError("That symbol could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <LabHeader kicker="Stock files" live={false}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Dashboard</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/paper">Paper</Link>
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each NSE symbol is a file under this page. A save stores the latest price, valuation, shareholding, and published results, and replaces the reading if you save again the same day. The next day is a new snapshot, so you can see what moved. These files do not say whether a stock is worth buying.
        </p>
        <form onSubmit={(event) => void save(event)} className="flex max-w-md flex-wrap items-center gap-2">
          <Input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="NSE symbol"
            aria-label="NSE symbol"
            className="max-w-[12rem] uppercase"
          />
          <Button type="submit" size="sm" disabled={saving || !symbol.trim()}>
            {saving ? "Saving" : "Save stock"}
          </Button>
        </form>
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stocks.map((stock) => (
            <Link key={stock.symbol} href={`/stocks/${stock.symbol}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{stock.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {stock.symbol}
                    {stock.industry ? ` · ${stock.industry}` : ""}
                  </p>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-semibold tabular-nums">{formatRupee(stock.price)}</p>
                  <p className={`text-sm tabular-nums ${pnlClass(stock.changePercent)}`}>
                    {stock.changePercent == null ? "—" : `${formatNumber(stock.changePercent)}% today`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {stocks.length === 0 ? <p className="text-sm text-muted-foreground">No stock files yet.</p> : null}
      </main>
    </>
  );
}
