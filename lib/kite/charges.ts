import { isCompleteOrder, type PublicPendingOrder } from "@/lib/kite/orders";
import type { VirtualContractParam } from "kiteconnect";

interface ChargeClient {
  getvirtualContractNote(orders: VirtualContractParam[]): Promise<unknown>;
}

const VARIETIES = new Set(["regular", "amo", "co", "iceberg", "auction"]);
const PRODUCTS = new Set(["NRML", "MIS", "CNC"]);
const SIDES = new Set(["BUY", "SELL"]);
const ORDER_TYPES = new Set(["MARKET", "LIMIT", "SL", "SL-M"]);
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "CDS", "BCD", "MCX"]);
const CACHE_MS = 20_000;

export interface ChargeSummary {
  total: number | null;
  complete: boolean;
  count: number;
}

interface ChargeCache {
  key: string;
  at: number;
  totals: Record<string, number>;
}

const globalCharges = globalThis as typeof globalThis & { __nrlOrderCharges?: Map<string, ChargeCache> };

function cacheBucket(): Map<string, ChargeCache> {
  if (!globalCharges.__nrlOrderCharges) globalCharges.__nrlOrderCharges = new Map();
  return globalCharges.__nrlOrderCharges;
}

export function chargeRequests(orders: PublicPendingOrder[]): VirtualContractParam[] {
  const requests: VirtualContractParam[] = [];
  for (const order of orders) {
    if (!isCompleteOrder(order)) continue;
    const variety = order.variety.toLowerCase();
    const product = order.product.toUpperCase();
    const side = order.side.toUpperCase();
    const orderType = order.orderType.toUpperCase();
    const exchange = order.exchange.toUpperCase();
    const quantity = order.filledQuantity > 0 ? order.filledQuantity : order.quantity;
    if (!VARIETIES.has(variety) || !PRODUCTS.has(product) || !SIDES.has(side) || !ORDER_TYPES.has(orderType)) continue;
    if (!EXCHANGES.has(exchange) || !Number.isInteger(quantity) || quantity < 1) continue;
    if (order.averagePrice == null || order.averagePrice <= 0) continue;
    requests.push({
      order_id: order.id,
      exchange: exchange as VirtualContractParam["exchange"],
      tradingsymbol: order.symbol,
      transaction_type: side as VirtualContractParam["transaction_type"],
      variety: variety as VirtualContractParam["variety"],
      product: product as VirtualContractParam["product"],
      order_type: orderType as VirtualContractParam["order_type"],
      quantity,
      average_price: order.averagePrice,
    });
  }
  return requests.slice(0, 40);
}

export function totalsFromNotes(
  requests: VirtualContractParam[],
  notes: unknown,
): Record<string, number> | null {
  if (!Array.isArray(notes) || notes.length !== requests.length) return null;
  const totals: Record<string, number> = {};
  requests.forEach((request, index) => {
    const note = notes[index] as { charges?: { total?: unknown } } | null;
    const total = Number(note?.charges?.total);
    if (!Number.isFinite(total)) return;
    totals[String(request.order_id)] = total;
  });
  return totals;
}

export function applyChargeTotals(orders: PublicPendingOrder[], totals: Record<string, number>): PublicPendingOrder[] {
  return orders.map((order) => ({ ...order, charges: Object.prototype.hasOwnProperty.call(totals, order.id) ? totals[order.id] ?? null : null }));
}

export function summarizeCharges(orders: PublicPendingOrder[] | null): ChargeSummary {
  if (!orders) return { total: null, complete: false, count: 0 };
  const completed = orders.filter(isCompleteOrder);
  if (completed.length === 0) return { total: 0, complete: true, count: 0 };
  const known = completed.filter((order) => order.charges != null);
  if (known.length === 0) return { total: null, complete: false, count: completed.length };
  const total = known.reduce((sum, order) => sum + (order.charges ?? 0), 0);
  return { total, complete: known.length === completed.length, count: completed.length };
}

function requestKey(requests: VirtualContractParam[]): string {
  return requests
    .map((request) => [request.order_id, request.average_price, request.quantity, request.transaction_type].join(":"))
    .join("|");
}

export async function withOrderCharges(
  client: ChargeClient,
  orders: PublicPendingOrder[],
  sessionId: string,
  now = Date.now(),
): Promise<PublicPendingOrder[]> {
  const requests = chargeRequests(orders);
  if (requests.length === 0) return orders.map((order) => ({ ...order, charges: null }));
  const key = requestKey(requests);
  const cached = cacheBucket().get(sessionId);
  if (cached && cached.key === key && now - cached.at < CACHE_MS) return applyChargeTotals(orders, cached.totals);
  const notes = await client.getvirtualContractNote(requests);
  const totals = totalsFromNotes(requests, notes);
  if (!totals) return orders.map((order) => ({ ...order, charges: null }));
  cacheBucket().set(sessionId, { key, at: now, totals });
  return applyChargeTotals(orders, totals);
}
