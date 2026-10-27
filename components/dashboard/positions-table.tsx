"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatInr, formatNumber, formatPercentPoints, pnlClass } from "@/lib/format";
import { alignPrice, needsLimitPrice, parseOrderCommand, positionOrderIntent, quantityFitsLot } from "@/lib/kite/order-actions";
import type { PublicPortfolio, PublicPosition } from "@/lib/kite/portfolio";
import type { PositionGreeks } from "@/lib/scenario/engine";
import { isNseRegularSession } from "@/lib/time";
import type { QuoteQuality } from "@/lib/kite/types";

export function qualityLabel(quality: QuoteQuality): string {
  switch (quality) {
    case "live":
      return "Live snapshot";
    case "delayed":
      return "Delayed";
    case "stale":
      return "Stale";
    case "market-closed":
      return "Market closed";
    default:
      return "Unavailable";
  }
}

interface TradeDraft {
  positionId: string;
  symbol: string;
  action: "exit" | "add";
  side: "BUY" | "SELL";
  product: "NRML" | "MIS";
  quantity: string;
  orderType: "LIMIT" | "MARKET";
  price: string;
  variety: "regular" | "amo";
  lotSize: number | null;
}

const fieldClass = "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function limitPrice(position: PublicPosition): string {
  const price = position.quote.ltp ?? position.quote.price ?? position.brokerLastPrice;
  if (price == null || !Number.isFinite(price) || price <= 0) return "";
  return String(alignPrice(price, position.tickSize ?? 0.05));
}

export function PositionsTable({
  portfolio,
  greeks,
  excludedIds,
  onToggleExcluded,
  onPlaced,
}: {
  portfolio: PublicPortfolio;
  greeks: PositionGreeks[];
  excludedIds: string[];
  onToggleExcluded: (id: string) => void;
  onPlaced?: () => void;
}) {
  const byId = new Map(greeks.map((row) => [row.id, row]));
  const excluded = new Set(excludedIds);
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function openTrade(position: PublicPosition, action: "exit" | "add") {
    const intent = positionOrderIntent(position, action);
    if (!intent.ok) {
      setDraft(null);
      setSent(null);
      setMessage(intent.error);
      return;
    }
    setMessage(null);
    setSent(null);
    setDraft({
      positionId: position.id,
      symbol: position.tradingSymbol,
      action,
      side: intent.intent.side,
      product: intent.intent.product,
      quantity: String(intent.intent.quantity),
      orderType: "LIMIT",
      price: limitPrice(position),
      variety: isNseRegularSession(new Date()) ? "regular" : "amo",
      lotSize: position.lotSize,
    });
  }

  async function placeDraft() {
    if (!draft) return;
    const parsed = parseOrderCommand({
      action: "place",
      confirm: true,
      symbol: draft.symbol,
      side: draft.side,
      quantity: Number(draft.quantity),
      product: draft.product,
      orderType: draft.orderType,
      price: draft.price === "" ? null : Number(draft.price),
      triggerPrice: null,
      variety: draft.variety,
    });
    if (!parsed.ok || parsed.command.action !== "place") {
      setMessage(parsed.ok ? "The order request was not valid." : parsed.error);
      return;
    }
    if (!quantityFitsLot(parsed.command.quantity, draft.lotSize)) {
      setMessage(`Quantity must be a multiple of the lot size (${draft.lotSize}).`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/kite/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed.command, confirm: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; orderId?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Zerodha did not accept that order request. Check the order book before trying again.");
        return;
      }
      setSent(`${draft.action === "exit" ? "Exit" : "Add"} order ${body.orderId ?? ""} sent to Zerodha.`);
      setDraft(null);
      onPlaced?.();
    } catch {
      setMessage("The order request could not be sent. Check the order book before trying again.");
    } finally {
      setBusy(false);
    }
  }
  if (portfolio.positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="text-base font-medium">No open NIFTY option positions</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          The net positions feed has no CE or PE contracts on NIFTY with a non-zero quantity. Flat contracts stay
          hidden unless you turn on “Show flat”.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message ? <p className="text-sm text-rose-700 dark:text-rose-400">{message}</p> : null}
      {sent ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{sent}</p> : null}
    <Table>
      <TableCaption>
        Quantity is the signed net quantity from Kite, already in option units. Lot size is not applied again. Greeks
        are model values, not broker fields. Exit closes the position. Add increases it by one lot. Neither is sent until you confirm. Turning off “In model” leaves that contract out of the scenario only.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 bg-card">Contract</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Avg</TableHead>
          <TableHead className="text-right">LTP</TableHead>
          <TableHead className="text-right">IV</TableHead>
          <TableHead className="text-right">Delta</TableHead>
          <TableHead className="text-right">Gamma</TableHead>
          <TableHead className="text-right">Theta/day</TableHead>
          <TableHead className="text-right">Vega</TableHead>
          <TableHead className="text-right">Day P&L</TableHead>
          <TableHead className="text-right">Broker uPnL</TableHead>
          <TableHead className="text-right">Broker net</TableHead>
          <TableHead>In model</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {portfolio.positions.map((position) => {
          const greek = byId.get(position.id);
          return (
            <Fragment key={position.id}>
            <TableRow className={excluded.has(position.id) ? "opacity-50" : undefined}>
              <TableCell className="sticky left-0 z-10 bg-card">
                <div className="font-medium">{position.tradingSymbol}</div>
                <div className="text-xs text-muted-foreground">
                  {position.optionType} {position.strike ?? "—"} · {position.expiry ? position.expiry.slice(0, 10) : "expiry n/a"}
                </div>
                <div className="mt-2 flex gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={busy || position.quantity === 0} onClick={() => openTrade(position, "exit")}>
                    Exit
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => openTrade(position, "add")}>
                    Add
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <Badge className={position.side === "long" ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300" : "border-rose-600/40 text-rose-700 dark:text-rose-300"}>
                  {position.side}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.quantity, 0)}</TableCell>
              <TableCell>{position.product}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.averagePrice)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.quote.ltp ?? position.brokerLastPrice)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatPercentPoints(greek?.iv)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.delta, 2)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.gamma, 4)}</TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(greek?.thetaPerDay)}`}>
                {formatNumber(greek?.thetaPerDay)}
              </TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.vegaPerPoint)}</TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(position.brokerDayPnl)}`}>
                {formatInr(position.brokerDayPnl)}
              </TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(position.brokerUnrealised)}`}>
                {formatInr(position.brokerUnrealised)}
              </TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(position.brokerPnl)}`}>
                {formatInr(position.brokerPnl)}
              </TableCell>
              <TableCell>
                <Switch
                  checked={!excluded.has(position.id)}
                  onCheckedChange={() => onToggleExcluded(position.id)}
                  aria-label={`Include ${position.tradingSymbol} in the model`}
                />
              </TableCell>
            </TableRow>
            {draft?.positionId === position.id ? (
              <TableRow>
                <TableCell colSpan={15}>
                  <div className="sticky left-0 w-[min(100%,42rem)] space-y-3 rounded-md border border-amber-500/70 bg-amber-50 p-3 dark:bg-amber-950/40">
                    <p className="text-sm font-medium">
                      {draft.action === "exit" ? "Exit" : "Add"} {draft.symbol}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1 text-sm">
                        <Label>Quantity{draft.lotSize ? ` · lot ${draft.lotSize}` : ""}</Label>
                        <Input inputMode="numeric" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} />
                      </div>
                      <div className="space-y-1 text-sm">
                        <Label>Type</Label>
                        <select className={fieldClass} value={draft.orderType} onChange={(event) => setDraft({ ...draft, orderType: event.target.value === "MARKET" ? "MARKET" : "LIMIT" })}>
                          <option value="LIMIT">Limit</option>
                          <option value="MARKET">Market</option>
                        </select>
                      </div>
                      {needsLimitPrice(draft.orderType) ? (
                        <div className="space-y-1 text-sm">
                          <Label>Price</Label>
                          <Input inputMode="decimal" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
                        </div>
                      ) : null}
                      <div className="space-y-1 text-sm">
                        <Label>Session</Label>
                        <select className={fieldClass} value={draft.variety} onChange={(event) => setDraft({ ...draft, variety: event.target.value as "regular" | "amo" })}>
                          <option value="regular">Regular</option>
                          <option value="amo">After market</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-sm">
                      {draft.side} {draft.quantity || "—"} {draft.symbol}
                      {draft.orderType === "MARKET" ? " at market" : ` limit ${draft.price || "—"}`}, {draft.product},{" "}
                      {draft.variety === "amo" ? "after market" : "regular session"}. This places a live Zerodha order.
                    </p>
                    {message ? <p className="text-sm font-medium text-rose-700 dark:text-rose-400">{message}</p> : null}
                    <div className="flex gap-2">
                      <Button type="button" disabled={busy} onClick={() => void placeDraft()}>
                        {busy ? "Sending…" : draft.action === "exit" ? "Exit position" : "Add to position"}
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                        Back
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}
