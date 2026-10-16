import { parseNiftyOptionSymbol } from "@/lib/kite/positions";

const ORDER_TYPES = ["MARKET", "LIMIT", "SL", "SL-M"] as const;
const PRODUCTS = ["NRML", "MIS"] as const;
const SIDES = ["BUY", "SELL"] as const;
const PLACE_VARIETIES = ["regular", "amo"] as const;
const MODIFY_VARIETIES = ["regular", "amo"] as const;
const CANCEL_VARIETIES = ["regular", "amo", "bo", "co", "iceberg", "auction"] as const;

export type OrderTypeName = (typeof ORDER_TYPES)[number];
export type OrderProduct = (typeof PRODUCTS)[number];
export type OrderSide = (typeof SIDES)[number];

export interface PlaceOrderCommand {
  action: "place";
  symbol: string;
  side: OrderSide;
  quantity: number;
  product: OrderProduct;
  orderType: OrderTypeName;
  price: number | null;
  triggerPrice: number | null;
  variety: (typeof PLACE_VARIETIES)[number];
}

export interface ModifyOrderCommand {
  action: "modify";
  orderId: string;
  variety: (typeof MODIFY_VARIETIES)[number];
  quantity: number;
  orderType: OrderTypeName;
  price: number | null;
  triggerPrice: number | null;
}

export interface CancelOrderCommand {
  action: "cancel";
  orderId: string;
  variety: (typeof CANCEL_VARIETIES)[number];
}

export type OrderCommand = PlaceOrderCommand | ModifyOrderCommand | CancelOrderCommand;

export function needsLimitPrice(orderType: string): boolean {
  return orderType === "LIMIT" || orderType === "SL";
}

export function needsTrigger(orderType: string): boolean {
  return orderType === "SL" || orderType === "SL-M";
}

function readRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function readQuantity(value: unknown): number | null {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200_000) return null;
  return quantity;
}

function readPrice(value: unknown, required: boolean): number | null | undefined {
  if (value == null || value === "") return required ? undefined : null;
  const price = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 100_000) return undefined;
  return Math.round(price * 100) / 100;
}

function readOrderType(value: unknown): OrderTypeName | null {
  const orderType = String(value ?? "").toUpperCase();
  return ORDER_TYPES.includes(orderType as OrderTypeName) ? (orderType as OrderTypeName) : null;
}

function readOrderId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return /^[0-9]{1,20}$/.test(id) ? id : null;
}

function pricesFor(orderType: OrderTypeName, record: Record<string, unknown>): { price: number | null; triggerPrice: number | null } | string {
  const price = readPrice(record.price, needsLimitPrice(orderType));
  const triggerPrice = readPrice(record.triggerPrice, needsTrigger(orderType));
  if (price === undefined) return "Enter a price above zero for this order type.";
  if (triggerPrice === undefined) return "Enter a trigger price above zero for this order type.";
  return { price: needsLimitPrice(orderType) ? price : null, triggerPrice: needsTrigger(orderType) ? triggerPrice : null };
}

/** Rejects a request that is missing confirmation or has an unsafe field. Nothing is sent to Zerodha. */
export function parseOrderCommand(body: unknown): { ok: true; command: OrderCommand } | { ok: false; error: string } {
  const record = readRecord(body);
  if (!record) return { ok: false, error: "The order request was not valid." };
  if (record.confirm !== true) return { ok: false, error: "Confirm the order before it is sent." };
  const action = record.action;
  if (action === "place") return parsePlace(record);
  if (action === "modify") return parseModify(record);
  if (action === "cancel") return parseCancel(record);
  return { ok: false, error: "Choose place, modify, or cancel." };
}

function parsePlace(record: Record<string, unknown>): { ok: true; command: PlaceOrderCommand } | { ok: false; error: string } {
  const symbol = String(record.symbol ?? "").trim().toUpperCase();
  if (!parseNiftyOptionSymbol(symbol)) return { ok: false, error: "New orders from this page are limited to listed NIFTY options." };
  const side = String(record.side ?? "").toUpperCase();
  if (!SIDES.includes(side as OrderSide)) return { ok: false, error: "Choose buy or sell." };
  const quantity = readQuantity(record.quantity);
  if (quantity == null) return { ok: false, error: "Quantity must be a whole number of contracts." };
  const product = String(record.product ?? "").toUpperCase();
  if (!PRODUCTS.includes(product as OrderProduct)) return { ok: false, error: "Choose NRML or MIS." };
  const orderType = readOrderType(record.orderType);
  if (!orderType) return { ok: false, error: "Choose a market, limit, or stop order." };
  const variety = String(record.variety ?? "").toLowerCase();
  if (!PLACE_VARIETIES.includes(variety as PlaceOrderCommand["variety"])) {
    return { ok: false, error: "New orders can be regular or after-market." };
  }
  const prices = pricesFor(orderType, record);
  if (typeof prices === "string") return { ok: false, error: prices };
  return {
    ok: true,
    command: {
      action: "place",
      symbol,
      side: side as OrderSide,
      quantity,
      product: product as OrderProduct,
      orderType,
      price: prices.price,
      triggerPrice: prices.triggerPrice,
      variety: variety as PlaceOrderCommand["variety"],
    },
  };
}

function parseModify(record: Record<string, unknown>): { ok: true; command: ModifyOrderCommand } | { ok: false; error: string } {
  const orderId = readOrderId(record.orderId);
  if (!orderId) return { ok: false, error: "That order cannot be modified from this page." };
  const variety = String(record.variety ?? "").toLowerCase();
  if (!MODIFY_VARIETIES.includes(variety as ModifyOrderCommand["variety"])) {
    return { ok: false, error: "Only regular and after-market orders can be modified here. You can still cancel it." };
  }
  const quantity = readQuantity(record.quantity);
  if (quantity == null) return { ok: false, error: "Quantity must be a whole number of contracts." };
  const orderType = readOrderType(record.orderType);
  if (!orderType) return { ok: false, error: "Choose a market, limit, or stop order." };
  const prices = pricesFor(orderType, record);
  if (typeof prices === "string") return { ok: false, error: prices };
  return {
    ok: true,
    command: {
      action: "modify",
      orderId,
      variety: variety as ModifyOrderCommand["variety"],
      quantity,
      orderType,
      price: prices.price,
      triggerPrice: prices.triggerPrice,
    },
  };
}

function parseCancel(record: Record<string, unknown>): { ok: true; command: CancelOrderCommand } | { ok: false; error: string } {
  const orderId = readOrderId(record.orderId);
  if (!orderId) return { ok: false, error: "That order cannot be cancelled from this page." };
  const variety = String(record.variety ?? "").toLowerCase();
  if (!CANCEL_VARIETIES.includes(variety as CancelOrderCommand["variety"])) {
    return { ok: false, error: "This order variety cannot be cancelled from this page." };
  }
  return { ok: true, command: { action: "cancel", orderId, variety: variety as CancelOrderCommand["variety"] } };
}

/** Nearest valid limit. NIFTY options move in 0.05 unless the contract says otherwise. */
export function alignPrice(price: number, tick = 0.05): number {
  if (!Number.isFinite(price) || !Number.isFinite(tick) || tick <= 0) return price;
  const places = Math.min(4, (tick.toString().split(".")[1] ?? "").length);
  return Number((Math.round(price / tick) * tick).toFixed(places));
}

export function quantityFitsLot(quantity: number, lotSize: number | null): boolean {
  if (lotSize == null || lotSize < 1) return true;
  return quantity % lotSize === 0;
}

export interface PositionOrderIntent {
  side: OrderSide;
  quantity: number;
  product: OrderProduct;
}

/** Exit takes the opposite side for the whole position. Add keeps the side and uses one lot. */
export function positionOrderIntent(
  position: { quantity: number; product: string; lotSize: number | null },
  action: "exit" | "add",
): { ok: true; intent: PositionOrderIntent } | { ok: false; error: string } {
  const product = position.product.toUpperCase();
  if (product !== "NRML" && product !== "MIS") {
    return { ok: false, error: "Only NRML and MIS positions can be traded from this page." };
  }
  const held = Math.abs(position.quantity);
  if (action === "exit") {
    if (!Number.isInteger(held) || held < 1) return { ok: false, error: "This position is flat, so there is nothing to exit." };
    return { ok: true, intent: { side: position.quantity < 0 ? "BUY" : "SELL", quantity: held, product } };
  }
  const lot = position.lotSize != null && position.lotSize > 0 ? position.lotSize : held;
  if (!Number.isInteger(lot) || lot < 1) {
    return { ok: false, error: "Lot size is unavailable, so enter the quantity on a new order." };
  }
  return { ok: true, intent: { side: position.quantity < 0 ? "SELL" : "BUY", quantity: lot, product } };
}
