import { parseKiteTimestamp } from "@/lib/time";

/** Statuses Kite uses once an order is no longer working in the market. */
const CLOSED = new Set(["COMPLETE", "CANCELLED", "REJECTED"]);

export interface KiteOrderSnapshot {
  order_id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  product: string;
  status: string;
  quantity: number;
  pending_quantity: number;
  filled_quantity: number;
  price: number;
  trigger_price: number;
  variety: string;
  order_timestamp: Date | string | null;
  status_message: string | null;
  average_price?: number;
}

export interface PublicPendingOrder {
  id: string;
  symbol: string;
  exchange: string;
  side: string;
  orderType: string;
  product: string;
  status: string;
  quantity: number;
  pendingQuantity: number;
  filledQuantity: number;
  /** Limit price. Null for a market order or a zero price. */
  price: number | null;
  triggerPrice: number | null;
  variety: string;
  placedAt: string | null;
  statusMessage: string | null;
  /** Last traded price. Null when the quote is missing. */
  currentPrice: number | null;
  /** Live price minus the set price. Null for a market order. */
  gap: number | null;
  /** Average fill price. Null until Kite reports one. */
  averagePrice: number | null;
  /** Zerodha charge total for a completed order. Null until the charge calculation returns. */
  charges: number | null;
}

export type OrderNoticeKind = "new" | "modified" | "filled" | "completed" | "cancelled" | "rejected";

export interface OrderNotice {
  key: string;
  kind: OrderNoticeKind;
  title: string;
  symbol: string;
  side: string;
  detail: string;
}

const NOTICE_TITLE: Record<OrderNoticeKind, string> = {
  new: "New order",
  modified: "Order modified",
  filled: "Order filled",
  completed: "Order completed",
  cancelled: "Order cancelled",
  rejected: "Order rejected",
};

function positive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function money(value: number | null): string {
  if (value === null) return "Mkt";
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isOpenOrder(order: PublicPendingOrder): boolean {
  return !CLOSED.has(order.status);
}

export function isCompleteOrder(order: PublicPendingOrder): boolean {
  return order.status === "COMPLETE";
}

export function mapOrders(orders: KiteOrderSnapshot[]): PublicPendingOrder[] {
  const mapped = orders.flatMap((order) => {
    if (!order?.order_id || !order.tradingsymbol) return [];
    const status = String(order.status ?? "").trim().toUpperCase();
    if (!status) return [];
    const placed = parseKiteTimestamp(order.order_timestamp);
    const orderType = String(order.order_type ?? "").toUpperCase();
    return [
      {
        id: order.order_id,
        symbol: order.tradingsymbol,
        exchange: order.exchange,
        side: String(order.transaction_type ?? "").toUpperCase(),
        orderType,
        product: order.product,
        status,
        quantity: Number.isFinite(order.quantity) ? order.quantity : 0,
        pendingQuantity: Number.isFinite(order.pending_quantity) ? order.pending_quantity : 0,
        filledQuantity: Number.isFinite(order.filled_quantity) ? order.filled_quantity : 0,
        price: orderType === "MARKET" ? null : positive(order.price),
        triggerPrice: positive(order.trigger_price),
        variety: order.variety,
        placedAt: placed ? placed.toISOString() : null,
        statusMessage: order.status_message?.trim() ? order.status_message.trim() : null,
        currentPrice: null,
        gap: null,
        averagePrice: positive(Number(order.average_price)),
        charges: null,
      },
    ];
  });
  mapped.sort((left, right) => (right.placedAt ?? "").localeCompare(left.placedAt ?? ""));
  return mapped;
}

export function selectPendingOrders(orders: KiteOrderSnapshot[]): PublicPendingOrder[] {
  return mapOrders(orders).filter(isOpenOrder);
}

/** The price the order is working at. A stop-market order uses its trigger. */
export function orderSetPrice(order: Pick<PublicPendingOrder, "price" | "triggerPrice" | "orderType">): number | null {
  if (order.price !== null) return order.price;
  if (order.orderType === "SL-M") return order.triggerPrice;
  return null;
}

export function withLiveMarks(orders: PublicPendingOrder[], lastPrices: Map<string, number | null>): PublicPendingOrder[] {
  return orders.map((order) => {
    if (!isOpenOrder(order)) return order;
    const current = lastPrices.get(`${order.exchange}:${order.symbol}`) ?? null;
    const set = orderSetPrice(order);
    const gap = current !== null && set !== null ? current - set : null;
    return {
      ...order,
      currentPrice: current,
      gap: gap !== null && Number.isFinite(gap) ? gap : null,
    };
  });
}

function signature(order: PublicPendingOrder): string {
  return [
    order.status,
    order.quantity,
    order.pendingQuantity,
    order.filledQuantity,
    order.price ?? "",
    order.triggerPrice ?? "",
    order.orderType,
    order.product,
  ].join("|");
}

function contractLine(order: PublicPendingOrder): string {
  const price = order.orderType === "MARKET" ? "Mkt" : money(order.price);
  return `${order.side || "—"} ${order.quantity} ${order.symbol} · ${price}`;
}

function classify(prior: PublicPendingOrder, order: PublicPendingOrder): OrderNoticeKind {
  if (order.status === "COMPLETE" && prior.status !== "COMPLETE") return "completed";
  if (order.status === "CANCELLED" && prior.status !== "CANCELLED") return "cancelled";
  if (order.status === "REJECTED" && prior.status !== "REJECTED") return "rejected";
  if (order.filledQuantity > prior.filledQuantity) return "filled";
  return "modified";
}

function describe(kind: OrderNoticeKind, prior: PublicPendingOrder, order: PublicPendingOrder): string {
  if (kind === "completed") return `${contractLine(order)} filled.`;
  if (kind === "cancelled") return `${contractLine(order)} cancelled.`;
  if (kind === "rejected") return order.statusMessage ?? `${contractLine(order)} rejected.`;
  if (kind === "filled") return `${order.filledQuantity} of ${order.quantity} ${order.symbol} filled.`;
  const parts: string[] = [];
  if (prior.price !== order.price) parts.push(`price ${money(prior.price)} → ${money(order.price)}`);
  if (prior.quantity !== order.quantity) parts.push(`qty ${prior.quantity} → ${order.quantity}`);
  if (prior.triggerPrice !== order.triggerPrice) parts.push(`trigger ${money(prior.triggerPrice)} → ${money(order.triggerPrice)}`);
  if (prior.orderType !== order.orderType) parts.push(`type ${prior.orderType} → ${order.orderType}`);
  if (prior.status !== order.status) parts.push(`status ${prior.status} → ${order.status}`);
  const change = parts.slice(0, 2).join(", ");
  return change ? `${order.symbol} ${change}.` : `${contractLine(order)} updated.`;
}

function arrival(order: PublicPendingOrder): { kind: OrderNoticeKind; detail: string } {
  if (order.status === "REJECTED") {
    return { kind: "rejected", detail: order.statusMessage ?? `${contractLine(order)} was rejected.` };
  }
  if (order.status === "CANCELLED") {
    return { kind: "cancelled", detail: `${contractLine(order)} was cancelled.` };
  }
  if (order.status === "COMPLETE") {
    return { kind: "completed", detail: `${contractLine(order)} was filled.` };
  }
  return { kind: "new", detail: `${contractLine(order)} placed.` };
}

function notice(kind: OrderNoticeKind, order: PublicPendingOrder, detail: string): OrderNotice {
  return {
    key: `${order.id}:${kind}:${signature(order)}`,
    kind,
    title: NOTICE_TITLE[kind],
    symbol: order.symbol,
    side: order.side,
    detail,
  };
}

/** Changes since the previous successful order book. The first book is only a baseline. */
export function diffOrders(previous: PublicPendingOrder[] | null, next: PublicPendingOrder[]): OrderNotice[] {
  if (!previous) return [];
  const before = new Map(previous.map((order) => [order.id, order]));
  const after = new Set(next.map((order) => order.id));
  const notices: OrderNotice[] = [];
  for (const order of next) {
    const prior = before.get(order.id);
    if (!prior) {
      const arrived = arrival(order);
      notices.push(notice(arrived.kind, order, arrived.detail));
      continue;
    }
    if (signature(prior) === signature(order)) continue;
    const kind = classify(prior, order);
    notices.push(notice(kind, order, describe(kind, prior, order)));
  }
  for (const prior of previous) {
    if (after.has(prior.id) || !isOpenOrder(prior)) continue;
    notices.push(notice("cancelled", prior, `${contractLine(prior)} left the order book.`));
  }
  return notices;
}
