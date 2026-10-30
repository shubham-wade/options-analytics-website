"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { LabHeader } from "@/components/dashboard/lab-header";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber, formatRupee, formatSigned, pnlClass } from "@/lib/format";
import { StockHighlightPicker } from "@/components/stocks/stock-highlight";
import { highlightFrameClass, highlightToneStyle, screenerUrl, sortByHighlight, toStockSummary } from "@/lib/stocks/parse";
import { cn } from "@/lib/utils";
import type { StockFile, StockHighlight, StockSummary } from "@/lib/stocks/types";

const HIGHLIGHT_SORT_HOLD_MS = 5000;

export function StockLibrary() {
  const router = useRouter();
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(0);
  const [refreshSymbol, setRefreshSymbol] = useState<string | null>(null);
  const sortTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markGen = useRef(0);

  useEffect(
    () => () => {
      if (sortTimer.current) clearTimeout(sortTimer.current);
    },
    [],
  );

  function queueHighlightSort() {
    if (sortTimer.current) clearTimeout(sortTimer.current);
    sortTimer.current = setTimeout(() => {
      setStocks((current) => sortByHighlight(current));
      sortTimer.current = null;
    }, HIGHLIGHT_SORT_HOLD_MS);
  }

  useEffect(() => {
    void fetch("/api/stocks", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { stocks?: StockSummary[] }) => setStocks(sortByHighlight(body.stocks ?? [])))
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

  async function refreshAll() {
    const queue = stocks.map((stock) => stock.symbol);
    if (queue.length === 0 || refreshing) return;
    setRefreshing(true);
    setRefreshDone(0);
    setRefreshSymbol(queue[0] ?? null);
    setError(null);
    const failed: string[] = [];
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const next = queue[index];
        setRefreshSymbol(next);
        setRefreshDone(index);
        try {
          const response = await fetch(`/api/stocks/${encodeURIComponent(next)}`, { method: "POST" });
          const body = (await response.json()) as { error?: string; file?: StockFile };
          if (!response.ok || !body.file) {
            failed.push(next);
            continue;
          }
          setStocks((current) =>
            sortByHighlight(current.map((stock) => (stock.symbol === next ? toStockSummary(body.file as StockFile) : stock))),
          );
        } catch {
          failed.push(next);
        }
      }
      setRefreshDone(queue.length);
      if (failed.length > 0) setError(`Could not refresh ${failed.join(", ")}.`);
    } finally {
      setRefreshing(false);
      setRefreshSymbol(null);
    }
  }

  async function mark(nextSymbol: string, highlight: StockHighlight) {
    const gen = (markGen.current += 1);
    setError(null);
    setStocks((current) => current.map((stock) => (stock.symbol === nextSymbol ? { ...stock, highlight } : stock)));
    queueHighlightSort();
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(nextSymbol)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlight }),
      });
      if (gen !== markGen.current) return;
      const body = (await response.json()) as { error?: string };
      if (!response.ok) setError(body.error ?? "The highlight could not be saved.");
    } catch {
      if (gen !== markGen.current) return;
      setError("The highlight could not be saved.");
    }
  }

  return (
    <>
      <LabHeader kicker="Stock files" live={false} refreshing={refreshing}>
        <ThemeToggle />
        <Button variant="outline" size="sm" asChild>
          <Link href="/">Dashboard</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/paper">Paper</Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || saving || stocks.length === 0}
          onClick={() => void refreshAll()}
        >
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {refreshing ? `Refreshing ${Math.min(refreshDone + 1, stocks.length)} of ${stocks.length}` : "Refresh"}
        </Button>
      </LabHeader>
      <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each NSE symbol is a file under this page. A save stores the latest price, valuation, shareholding, and published results, and replaces the reading if you save again the same day. The next day is a new snapshot, so you can see what moved. Remove on a file page drops that file after a confirm. These files do not say whether a stock is worth buying.
        </p>
        <form onSubmit={(event) => void save(event)} className="flex max-w-md flex-wrap items-center gap-2">
          <Input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="NSE symbol"
            aria-label="NSE symbol"
            className="max-w-[12rem] uppercase"
          />
          <Button type="submit" size="sm" disabled={saving || refreshing || !symbol.trim()}>
            {saving ? "Saving" : "Save stock"}
          </Button>
        </form>
        {refreshing ? (
          <div className="max-w-md space-y-2" aria-live="polite">
            <p className="text-sm text-muted-foreground">
              Fetching {refreshSymbol}
              {stocks.length > 0 ? ` · ${Math.min(refreshDone + 1, stocks.length)} of ${stocks.length}` : ""}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-teal-500 transition-[width] duration-300"
                style={{ width: `${stocks.length === 0 ? 0 : (refreshDone / stocks.length) * 100}%` }}
              />
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stocks.map((stock, index) => (
            <Card
              key={stock.symbol}
              className={cn(
                "relative h-full overflow-visible border-2 transition-[border-color,box-shadow] duration-500",
                highlightFrameClass(stock.highlight),
                refreshing && refreshSymbol === stock.symbol && "opacity-70",
              )}
              style={highlightToneStyle(stock.highlight) as CSSProperties}
            >
              <div className="absolute right-2 top-2 z-10">
                <StockHighlightPicker
                  value={stock.highlight}
                  disabled={refreshing}
                  onChange={(next) => void mark(stock.symbol, next)}
                />
              </div>
              <Link href={`/stocks/${stock.symbol}`} className="block rounded-lg transition-colors hover:bg-muted/40">
                <CardHeader className="pr-10">
                  <CardTitle>{stock.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {stock.symbol}
                    {stock.industry ? ` · ${stock.industry}` : ""}
                  </p>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-3 pb-2">
                  <p className="text-2xl font-semibold tabular-nums">{formatRupee(stock.price)}</p>
                  <p className={`text-sm tabular-nums ${pnlClass(stock.changePercent)}`}>
                    {stock.changePercent == null ? "—" : `${formatNumber(stock.changePercent)}% today`}
                  </p>
                </CardContent>
                <CardContent className="space-y-1 pt-0 text-xs text-muted-foreground">
                  <p className={`tabular-nums ${stock.fromHighPercent != null && stock.fromHighPercent < -0.05 ? "text-rose-700 dark:text-rose-400" : ""}`}>
                    {stock.fromHighPercent == null
                      ? "52-week high —"
                      : stock.fromHighPercent >= -0.05
                        ? "At 52-week high"
                        : `${formatSigned(stock.fromHighPercent)}% from 52-week high`}
                  </p>
                  <p className="tabular-nums">
                    P/E {stock.pe == null ? "—" : formatNumber(stock.pe)} now
                    {" · "}
                    {stock.peMedian == null ? "—" : formatNumber(stock.peMedian)} med
                    {" · "}
                    {stock.peHigh == null ? "—" : formatNumber(stock.peHigh)} all-time high
                  </p>
                </CardContent>
              </Link>
              <CardContent className="flex items-end justify-between gap-3 pt-0">
                <a
                  href={screenerUrl(stock.symbol)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Screener
                </a>
                <p className="text-xs tabular-nums text-muted-foreground" aria-label={`Stock ${index + 1} of ${stocks.length}`}>
                  {index + 1}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {stocks.length === 0 ? <p className="text-sm text-muted-foreground">No stock files yet.</p> : null}
      </main>
    </>
  );
}
