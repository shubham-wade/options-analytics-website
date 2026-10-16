import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatIst, formatNumber, formatRupee } from "@/lib/format";
import type { PublicPendingOrder } from "@/lib/kite/orders";

export function CompletedOrders({
  orders,
  connected,
}: {
  orders: PublicPendingOrder[] | null;
  connected: boolean;
}) {
  return (
    <div>
      {!connected ? (
        <p className="text-sm text-muted-foreground">Connect Zerodha to see today’s completed orders.</p>
      ) : orders === null ? (
        <p className="text-sm text-muted-foreground">Loading today’s completed orders.</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders have completed today. Kite lists only the current trading day.</p>
      ) : (
        <Table>
          <TableCaption>
            Orders Kite has marked complete today. Charges are Zerodha’s total for that fill: brokerage, STT, exchange transaction charge, SEBI fee, stamp duty, and GST.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Filled</TableHead>
              <TableHead className="text-right">Average</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead>Placed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <div className="font-medium">{order.symbol}</div>
                  <div className="text-xs text-muted-foreground">{order.exchange}</div>
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
                <TableCell className="text-right font-mono tabular">{formatNumber(order.quantity, 0)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.filledQuantity, 0)}</TableCell>
                <TableCell className="text-right font-mono tabular">{formatNumber(order.averagePrice)}</TableCell>
                <TableCell className={`text-right font-mono tabular ${order.charges != null ? "text-rose-700 dark:text-rose-400" : ""}`}>
                  {formatRupee(order.charges)}
                </TableCell>
                <TableCell className="text-right font-mono tabular">
                  {order.orderType === "MARKET" ? "Mkt" : formatNumber(order.price)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatIst(order.placedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
