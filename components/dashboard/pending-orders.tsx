import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatIst, formatNumber, formatSigned } from "@/lib/format";
import type { PublicPendingOrder } from "@/lib/kite/orders";

function canModify(order: PublicPendingOrder): boolean {
  const variety = order.variety.toLowerCase();
  return variety === "regular" || variety === "amo";
}

function canCancel(order: PublicPendingOrder): boolean {
  return ["regular", "amo", "bo", "co", "iceberg", "auction"].includes(order.variety.toLowerCase());
}

export function PendingOrders({
  orders,
  connected,
  error,
  busy = false,
  onModify,
  onCancel,
}: {
  orders: PublicPendingOrder[] | null;
  connected: boolean;
  error: string | null;
  busy?: boolean;
  onModify?: (order: PublicPendingOrder) => void;
  onCancel?: (order: PublicPendingOrder) => void;
}) {
  return (
    <div>
      {error ? <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}
      {!connected ? (
        <p className="text-sm text-muted-foreground">Connect Zerodha to see today’s open orders.</p>
      ) : orders === null ? (
        <p className="text-sm text-muted-foreground">Loading today’s open orders.</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders are pending. Kite lists only the current trading day.</p>
      ) : (
        <Table>
          <TableCaption>
            Orders still working in the market. Current is the last traded price. Gap is that price minus the set price. A stop-market order uses its trigger. Modify and cancel are sent to Zerodha only after you confirm.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Filled</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Gap</TableHead>
              <TableHead className="text-right">Trigger</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <div className="font-medium">{order.symbol}</div>
                  <div className="text-xs text-muted-foreground">
                    {order.exchange}
                    {order.variety && order.variety.toLowerCase() !== "regular" ? ` · ${order.variety}` : ""}
                    {order.statusMessage ? ` · ${order.statusMessage}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      order.side === "BUY"
                        ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300"
                        : "border-rose-600/40 text-rose-700 dark:text-rose-300"
                    }
                  >
                    {order.side || "—"}
                  </Badge>
                </TableCell>
                <TableCell>{order.orderType === "MARKET" ? "Market" : order.orderType || "—"}</TableCell>
                <TableCell>{order.product}</TableCell>
                <TableCell>{order.status}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.quantity, 0)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.pendingQuantity, 0)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.filledQuantity, 0)}</TableCell>
                <TableCell className="text-right font-mono tabular">
                  {order.orderType === "MARKET" ? "Mkt" : formatNumber(order.price)}
                </TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.currentPrice)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatSigned(order.gap)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.triggerPrice)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatIst(order.placedAt)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !canModify(order)}
                      title={canModify(order) ? "Change quantity, price, or trigger" : "This variety can only be cancelled here"}
                      onClick={() => onModify?.(order)}
                    >
                      Modify
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !canCancel(order)}
                      onClick={() => onCancel?.(order)}
                    >
                      Cancel
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
