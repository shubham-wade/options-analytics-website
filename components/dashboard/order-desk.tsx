"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CompletedOrders } from "@/components/dashboard/completed-orders";
import { PendingOrders } from "@/components/dashboard/pending-orders";
import { Section } from "@/components/dashboard/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber, formatRupee } from "@/lib/format";
import { summarizeCharges } from "@/lib/kite/charges";
import { isCompleteOrder, isOpenOrder, type PublicPendingOrder } from "@/lib/kite/orders";
import {
  needsLimitPrice,
  needsTrigger,
  parseOrderCommand,
  quantityFitsLot,
  type CancelOrderCommand,
  type ModifyOrderCommand,
  type OrderCommand,
  type OrderTypeName,
  type PlaceOrderCommand,
} from "@/lib/kite/order-actions";

interface ListedContract {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  lotSize: number | null;
}

interface PlaceDraft {
  expiry: string;
  strike: string;
  right: "CE" | "PE";
  side: "BUY" | "SELL";
  quantity: string;
  product: "NRML" | "MIS";
  orderType: OrderTypeName;
  price: string;
  triggerPrice: string;
  variety: "regular" | "amo";
}

const EMPTY_DRAFT: PlaceDraft = {
  expiry: "",
  strike: "",
  right: "CE",
  side: "BUY",
  quantity: "",
  product: "NRML",
  orderType: "LIMIT",
  price: "",
  triggerPrice: "",
  variety: "regular",
};

const fieldClass = "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function moneyLabel(orderType: string, price: number | null, triggerPrice: number | null): string {
  if (orderType === "MARKET") return "at market";
  if (orderType === "SL-M") return `stop-market, trigger ${formatNumber(triggerPrice)}`;
  if (orderType === "SL") return `stop ${formatNumber(price)}, trigger ${formatNumber(triggerPrice)}`;
  return `limit ${formatNumber(price)}`;
}

function varietyLabel(variety: string): string {
  return variety === "amo" ? "after market" : "regular session";
}

export function OrderDesk({
  orders,
  connected,
  error,
  onDone,
  composerOpen,
  onComposerOpenChange,
}: {
  orders: PublicPendingOrder[] | null;
  connected: boolean;
  error: string | null;
  onDone: () => void;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
}) {
  const pending = orders === null ? null : orders.filter(isOpenOrder);
  const completed = orders === null ? null : orders.filter(isCompleteOrder);
  const charges = summarizeCharges(orders);
  const [contracts, setContracts] = useState<ListedContract[]>([]);
  const [draft, setDraft] = useState<PlaceDraft>(EMPTY_DRAFT);
  const [placeReview, setPlaceReview] = useState<PlaceOrderCommand | null>(null);
  const [editing, setEditing] = useState<PublicPendingOrder | null>(null);
  const [modifyDraft, setModifyDraft] = useState({ quantity: "", orderType: "LIMIT" as OrderTypeName, price: "", triggerPrice: "" });
  const [modifyReview, setModifyReview] = useState<ModifyOrderCommand | null>(null);
  const [cancelling, setCancelling] = useState<PublicPendingOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const appliedLot = useRef<number | null>(null);

  useEffect(() => {
    if (!connected) {
      setContracts([]);
      return;
    }
    let cancelled = false;
    void fetch("/api/kite/contracts")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { contracts?: ListedContract[] };
        if (!cancelled && Array.isArray(body.contracts)) setContracts(body.contracts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connected]);

  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onComposerOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composerOpen, onComposerOpenChange]);

  const expiries = useMemo(() => [...new Set(contracts.map((contract) => contract.expiry))], [contracts]);
  const strikes = useMemo(
    () =>
      [...new Set(contracts.filter((contract) => contract.expiry === draft.expiry).map((contract) => contract.strike))].sort(
        (left, right) => left - right,
      ),
    [contracts, draft.expiry],
  );
  const selected = contracts.find(
    (contract) => contract.expiry === draft.expiry && String(contract.strike) === draft.strike && contract.optionType === draft.right,
  );

  useEffect(() => {
    if (!draft.expiry && expiries[0]) setDraft((current) => ({ ...current, expiry: expiries[0] ?? "" }));
  }, [draft.expiry, expiries]);

  useEffect(() => {
    if (draft.strike && strikes.some((strike) => String(strike) === draft.strike)) return;
    const next = strikes[0];
    if (next != null) setDraft((current) => ({ ...current, strike: String(next) }));
  }, [draft.strike, strikes]);

  useEffect(() => {
    const lot = selected?.lotSize ?? null;
    if (!lot) return;
    setDraft((current) => {
      const qty = Number(current.quantity);
      if (current.quantity !== "" && qty !== appliedLot.current) return current;
      return { ...current, quantity: String(lot) };
    });
    appliedLot.current = lot;
  }, [selected?.lotSize, selected?.symbol]);

  async function send(command: OrderCommand) {
    setBusy(true);
    setMessage(null);
    setSent(null);
    try {
      const response = await fetch("/api/kite/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, confirm: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; orderId?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Zerodha did not accept that order request. Check the order book before trying again.");
        return;
      }
      setPlaceReview(null);
      setEditing(null);
      setModifyReview(null);
      setCancelling(null);
      setSent(command.action === "cancel" ? `Cancel request sent for order ${body.orderId ?? command.orderId}.` : `Order ${body.orderId ?? ""} sent to Zerodha.`);
      if (command.action === "place") onComposerOpenChange(false);
      onDone();
    } catch {
      setMessage("The order request could not be sent. Check the order book before trying again.");
    } finally {
      setBusy(false);
    }
  }

  function reviewPlace() {
    const parsed = parseOrderCommand({
      action: "place",
      confirm: true,
      symbol: selected?.symbol,
      side: draft.side,
      quantity: Number(draft.quantity),
      product: draft.product,
      orderType: draft.orderType,
      price: draft.price === "" ? null : Number(draft.price),
      triggerPrice: draft.triggerPrice === "" ? null : Number(draft.triggerPrice),
      variety: draft.variety,
    });
    if (!parsed.ok || parsed.command.action !== "place") {
      setPlaceReview(null);
      setMessage(parsed.ok ? "The order request was not valid." : parsed.error);
      return;
    }
    if (!quantityFitsLot(parsed.command.quantity, selected?.lotSize ?? null)) {
      setPlaceReview(null);
      setMessage(`Quantity must be a multiple of the lot size (${selected?.lotSize}).`);
      return;
    }
    setMessage(null);
    setPlaceReview(parsed.command);
  }

  function openModify(order: PublicPendingOrder) {
    setCancelling(null);
    setModifyReview(null);
    setPlaceReview(null);
    setEditing(order);
    setModifyDraft({
      quantity: String(order.quantity),
      orderType: (["MARKET", "LIMIT", "SL", "SL-M"].includes(order.orderType) ? order.orderType : "LIMIT") as OrderTypeName,
      price: order.price == null ? "" : String(order.price),
      triggerPrice: order.triggerPrice == null ? "" : String(order.triggerPrice),
    });
  }

  function reviewModify() {
    if (!editing) return;
    const parsed = parseOrderCommand({
      action: "modify",
      confirm: true,
      orderId: editing.id,
      variety: editing.variety.toLowerCase(),
      quantity: Number(modifyDraft.quantity),
      orderType: modifyDraft.orderType,
      price: modifyDraft.price === "" ? null : Number(modifyDraft.price),
      triggerPrice: modifyDraft.triggerPrice === "" ? null : Number(modifyDraft.triggerPrice),
    });
    if (!parsed.ok || parsed.command.action !== "modify") {
      setModifyReview(null);
      setMessage(parsed.ok ? "The order request was not valid." : parsed.error);
      return;
    }
    setMessage(null);
    setModifyReview(parsed.command);
  }

  function openCancel(order: PublicPendingOrder) {
    setEditing(null);
    setModifyReview(null);
    setPlaceReview(null);
    setCancelling(order);
    setMessage(null);
  }

  const cancelCommand: CancelOrderCommand | null = cancelling
    ? { action: "cancel", orderId: cancelling.id, variety: cancelling.variety.toLowerCase() as CancelOrderCommand["variety"] }
    : null;

  return (
    <>
      {composerOpen ? (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-24" onMouseDown={() => onComposerOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-order-title"
        className="w-full max-w-3xl rounded-lg border bg-card p-4 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="new-order-title" className="text-sm font-medium">New order</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => onComposerOpenChange(false)}>
            Close
          </Button>
        </div>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Places a live NIFTY option order on your Zerodha account. Nothing is sent until you confirm.
          </p>
          {!connected ? (
            <p className="text-sm text-muted-foreground">Connect Zerodha to place an order.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 text-sm">
                  <Label>Expiry</Label>
                  <select className={fieldClass} value={draft.expiry} onChange={(event) => setDraft({ ...draft, expiry: event.target.value, strike: "" })}>
                    {expiries.map((expiry) => (
                      <option key={expiry} value={expiry}>
                        {expiry}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Strike</Label>
                  <select className={fieldClass} value={draft.strike} onChange={(event) => setDraft({ ...draft, strike: event.target.value })}>
                    {strikes.map((strike) => (
                      <option key={strike} value={strike}>
                        {strike}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Right</Label>
                  <select className={fieldClass} value={draft.right} onChange={(event) => setDraft({ ...draft, right: event.target.value as "CE" | "PE" })}>
                    <option value="CE">CE</option>
                    <option value="PE">PE</option>
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Side</Label>
                  <select className={fieldClass} value={draft.side} onChange={(event) => setDraft({ ...draft, side: event.target.value as "BUY" | "SELL" })}>
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Quantity{selected?.lotSize ? ` · lot ${selected.lotSize}` : ""}</Label>
                  <Input inputMode="numeric" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} />
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Product</Label>
                  <select className={fieldClass} value={draft.product} onChange={(event) => setDraft({ ...draft, product: event.target.value as "NRML" | "MIS" })}>
                    <option value="NRML">NRML</option>
                    <option value="MIS">MIS</option>
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Type</Label>
                  <select
                    className={fieldClass}
                    value={draft.orderType}
                    onChange={(event) => setDraft({ ...draft, orderType: event.target.value as OrderTypeName })}
                  >
                    <option value="LIMIT">Limit</option>
                    <option value="MARKET">Market</option>
                    <option value="SL">Stop limit</option>
                    <option value="SL-M">Stop market</option>
                  </select>
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Session</Label>
                  <select className={fieldClass} value={draft.variety} onChange={(event) => setDraft({ ...draft, variety: event.target.value as "regular" | "amo" })}>
                    <option value="regular">Regular</option>
                    <option value="amo">After market</option>
                  </select>
                </div>
                {needsLimitPrice(draft.orderType) ? (
                  <div className="space-y-1 text-sm">
                    <Label>Price</Label>
                    <Input inputMode="decimal" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
                  </div>
                ) : null}
                {needsTrigger(draft.orderType) ? (
                  <div className="space-y-1 text-sm">
                    <Label>Trigger</Label>
                    <Input inputMode="decimal" value={draft.triggerPrice} onChange={(event) => setDraft({ ...draft, triggerPrice: event.target.value })} />
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{selected ? selected.symbol : "Choose a listed NIFTY option."}</p>
              {placeReview ? (
                <ConfirmPanel
                  text={`${placeReview.side} ${placeReview.quantity} ${placeReview.symbol}, ${moneyLabel(placeReview.orderType, placeReview.price, placeReview.triggerPrice)}, ${placeReview.product}, ${varietyLabel(placeReview.variety)}. This places a live Zerodha order.`}
                  confirmLabel="Place order"
                  busy={busy}
                  onBack={() => setPlaceReview(null)}
                  onConfirm={() => void send(placeReview)}
                />
              ) : (
                <Button type="button" disabled={!selected || busy} onClick={reviewPlace}>
                  Review order
                </Button>
              )}
              {message ? <p className="text-sm text-rose-700 dark:text-rose-400">{message}</p> : null}
            </>
          )}
        </div>
      </div>
      </div>
      ) : null}

      <Section title={`Pending orders${pending && pending.length > 0 ? ` · ${pending.length}` : ""}`}>
        <div className="space-y-4">
          {editing ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium">
                Modify {editing.side} {editing.symbol}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 text-sm">
                  <Label>Quantity</Label>
                  <Input inputMode="numeric" value={modifyDraft.quantity} onChange={(event) => setModifyDraft({ ...modifyDraft, quantity: event.target.value })} />
                </div>
                <div className="space-y-1 text-sm">
                  <Label>Type</Label>
                  <select
                    className={fieldClass}
                    value={modifyDraft.orderType}
                    onChange={(event) => setModifyDraft({ ...modifyDraft, orderType: event.target.value as OrderTypeName })}
                  >
                    <option value="LIMIT">Limit</option>
                    <option value="MARKET">Market</option>
                    <option value="SL">Stop limit</option>
                    <option value="SL-M">Stop market</option>
                  </select>
                </div>
                {needsLimitPrice(modifyDraft.orderType) ? (
                  <div className="space-y-1 text-sm">
                    <Label>Price</Label>
                    <Input inputMode="decimal" value={modifyDraft.price} onChange={(event) => setModifyDraft({ ...modifyDraft, price: event.target.value })} />
                  </div>
                ) : null}
                {needsTrigger(modifyDraft.orderType) ? (
                  <div className="space-y-1 text-sm">
                    <Label>Trigger</Label>
                    <Input
                      inputMode="decimal"
                      value={modifyDraft.triggerPrice}
                      onChange={(event) => setModifyDraft({ ...modifyDraft, triggerPrice: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
              {modifyReview ? (
                <ConfirmPanel
                  text={`Change order ${editing.id} to ${modifyReview.quantity} ${editing.symbol}, ${moneyLabel(modifyReview.orderType, modifyReview.price, modifyReview.triggerPrice)}. This updates the live Zerodha order.`}
                  confirmLabel="Modify order"
                  busy={busy}
                  onBack={() => setModifyReview(null)}
                  onConfirm={() => void send(modifyReview)}
                />
              ) : (
                <div className="flex gap-2">
                  <Button type="button" disabled={busy} onClick={reviewModify}>
                    Review change
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          {cancelling && cancelCommand ? (
            <ConfirmPanel
              text={`Cancel the ${cancelling.side} ${cancelling.quantity} ${cancelling.symbol} order ${cancelling.id}. This is sent to Zerodha now.`}
              confirmLabel="Cancel order"
              tone="danger"
              busy={busy}
              onBack={() => setCancelling(null)}
              onConfirm={() => void send(cancelCommand)}
            />
          ) : null}
          {!composerOpen && message ? <p className="text-sm text-rose-700 dark:text-rose-400">{message}</p> : null}
          {sent ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{sent}</p> : null}
          <PendingOrders
            orders={pending}
            connected={connected}
            error={error}
            busy={busy}
            onModify={openModify}
            onCancel={openCancel}
          />
        </div>
      </Section>

      <Section
        defaultOpen={false}
        title={
          <>
            Completed orders
            {completed && completed.length > 0 ? ` · ${completed.length}` : ""}
            {charges.count > 0 && charges.total != null ? (
              <span className="text-rose-700 dark:text-rose-400">
                {` · ${formatRupee(charges.total)}${charges.complete ? "" : " partial"}`}
              </span>
            ) : null}
          </>
        }
      >
        <CompletedOrders orders={completed} connected={connected} />
      </Section>
    </>
  );
}

function ConfirmPanel({
  text,
  confirmLabel,
  busy,
  tone = "live",
  onBack,
  onConfirm,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  tone?: "live" | "danger";
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-500/70 bg-amber-50 p-3 dark:bg-amber-950/40">
      <p className="text-sm">{text}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy}
          className={tone === "danger" ? "bg-rose-700 text-white hover:bg-rose-800" : undefined}
          onClick={onConfirm}
        >
          {busy ? "Sending…" : confirmLabel}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
