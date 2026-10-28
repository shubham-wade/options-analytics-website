import { NextResponse } from "next/server";
import { ConfigError, kiteApiKey, requireKiteConfig } from "@/lib/config";
import { asReader, createReadClient, sendKiteOrder } from "@/lib/kite/client";
import { mapKiteError, orderFailureMessage } from "@/lib/kite/errors";
import { expiredResponse } from "@/lib/kite/guard";
import { withOrderCharges } from "@/lib/kite/charges";
import { alignPrice, parseOrderCommand, quantityFitsLot, type OrderCommand } from "@/lib/kite/order-actions";
import { isOpenOrder, mapOrders, withLiveMarks, type KiteOrderSnapshot } from "@/lib/kite/orders";
import { sharedInstrumentCache } from "@/lib/kite/portfolio";
import { assessQuote } from "@/lib/kite/quotes";
import { forgetSnapshot } from "@/lib/kite/snapshot-cache";
import { destroyMemorySession, requestDesk, sessionFromRequest } from "@/lib/session/store";
import type { Connect } from "kiteconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return expiredResponse();

  try {
    requireKiteConfig();
    const client = createReadClient(kiteApiKey(session), session.accessToken);
    const orders = (await client.getOrders()) as KiteOrderSnapshot[];
    const mapped = mapOrders(Array.isArray(orders) ? orders : []);
    const keys = [...new Set(mapped.filter(isOpenOrder).map((order) => `${order.exchange}:${order.symbol}`))].slice(0, 40);
    const lastPrices = new Map<string, number | null>();
    if (keys.length > 0) {
      try {
        const quotes = await asReader(client).getQuote(keys);
        for (const key of keys) lastPrices.set(key, assessQuote(quotes[key], new Date()).ltp);
      } catch (error) {
        if (mapKiteError(error).code === "SESSION_EXPIRED") throw error;
      }
    }
    let priced = withLiveMarks(mapped, lastPrices);
    try {
      priced = await withOrderCharges(client, priced, session.id);
    } catch (error) {
      if (mapKiteError(error).code === "SESSION_EXPIRED") throw error;
      console.error(`Kite charges failed: ${mapKiteError(error).code}`);
    }
    return NextResponse.json(
      { orders: priced },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: "Zerodha credentials are not configured.", code: "BAD_REQUEST" }, { status: 500 });
    }
    const mapped = mapKiteError(error);
    console.error(`Kite order read failed: ${mapped.code}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(session.id);
      forgetSnapshot(session.id);
      return expiredResponse(!requestDesk(request));
    }
    return NextResponse.json({ error: mapped.publicMessage, code: mapped.code }, { status: mapped.httpStatus });
  }
}

const FINISHED = new Set(["COMPLETE", "CANCELLED", "REJECTED"]);

async function listedNiftyContract(client: Connect, symbol: string): Promise<{ lot: number; tick: number } | null> {
  const cached = await sharedInstrumentCache().get(
    (exchange) => asReader(client).getInstruments(exchange),
    Date.now(),
  );
  const match = cached.nfo.find(
    (instrument) =>
      instrument.tradingsymbol === symbol &&
      instrument.name === "NIFTY" &&
      (instrument.instrument_type === "CE" || instrument.instrument_type === "PE"),
  );
  const lot = Number(match?.lot_size);
  if (!Number.isFinite(lot) || lot <= 0) return null;
  const tick = Number(match?.tick_size);
  return { lot, tick: Number.isFinite(tick) && tick > 0 ? tick : 0.05 };
}

function withTradablePrice(command: OrderCommand, tick: number): OrderCommand {
  if (command.action === "cancel" || command.price == null) return command;
  return { ...command, price: alignPrice(command.price, tick) };
}

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return expiredResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The order request was not valid." }, { status: 400 });
  }
  const parsed = parseOrderCommand(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    requireKiteConfig();
    const client = createReadClient(kiteApiKey(session), session.accessToken);
    const requested = parsed.command;
    let command = requested;
    if (requested.action === "place") {
      const contract = await listedNiftyContract(client, requested.symbol);
      if (contract == null) {
        return NextResponse.json({ error: "That NIFTY option is not in the current contract list." }, { status: 400 });
      }
      if (!quantityFitsLot(requested.quantity, contract.lot)) {
        return NextResponse.json({ error: `Quantity must be a multiple of the lot size (${contract.lot}).` }, { status: 400 });
      }
      command = withTradablePrice(requested, contract.tick);
    } else {
      const book = (await client.getOrders()) as KiteOrderSnapshot[];
      const live = (Array.isArray(book) ? book : []).find((order) => order.order_id === requested.orderId);
      if (!live) {
        return NextResponse.json({ error: "That order is no longer on today's book. Refresh and try again." }, { status: 400 });
      }
      const status = String(live.status ?? "").trim().toUpperCase();
      if (FINISHED.has(status)) {
        return NextResponse.json({ error: "That order is already finished." }, { status: 400 });
      }
      if (String(live.variety ?? "").toLowerCase() !== requested.variety) {
        return NextResponse.json({ error: "The order changed. Refresh and try again." }, { status: 400 });
      }
      if (requested.action === "modify") {
        const filled = Number(live.filled_quantity);
        if (Number.isFinite(filled) && requested.quantity < filled) {
          return NextResponse.json({ error: "Quantity cannot be below the contracts already filled." }, { status: 400 });
        }
        const contract = await listedNiftyContract(client, live.tradingsymbol);
        if (contract != null && !quantityFitsLot(requested.quantity, contract.lot)) {
          return NextResponse.json({ error: `Quantity must be a multiple of the lot size (${contract.lot}).` }, { status: 400 });
        }
        command = withTradablePrice(requested, contract?.tick ?? 0.05);
      }
    }
    const orderId = await sendKiteOrder(client, command);
    console.info(`Kite order ${command.action} accepted`);
    return NextResponse.json({ orderId });
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: "Zerodha credentials are not configured.", code: "BAD_REQUEST" }, { status: 500 });
    }
    const mapped = mapKiteError(error);
    const failure = orderFailureMessage(error);
    console.error(`Kite order action failed: ${mapped.code}: ${failure.message}`);
    if (mapped.code === "SESSION_EXPIRED") {
      destroyMemorySession(session.id);
      forgetSnapshot(session.id);
      return expiredResponse(!requestDesk(request));
    }
    return NextResponse.json({ error: failure.message, code: mapped.code }, { status: failure.httpStatus });
  }
}
