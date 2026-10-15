import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatInr, formatNumber, formatPercentPoints, pnlClass } from "@/lib/format";
import type { PublicPortfolio } from "@/lib/kite/portfolio";
import type { PositionGreeks } from "@/lib/scenario/engine";
import type { QuoteQuality } from "@/lib/kite/types";

const qualityClass: Record<QuoteQuality, string> = {
  live: "border-emerald-500/40 text-emerald-300",
  delayed: "border-amber-500/40 text-amber-300",
  stale: "border-orange-500/40 text-orange-300",
  "market-closed": "border-slate-500/40 text-slate-300",
  unavailable: "border-rose-500/40 text-rose-300",
};

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

export function PositionsTable({
  portfolio,
  greeks,
}: {
  portfolio: PublicPortfolio;
  greeks: PositionGreeks[];
}) {
  const byId = new Map(greeks.map((row) => [row.id, row]));
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
    <Table>
      <TableCaption>
        Quantity is the signed net quantity from Kite, already in option units. Lot size is not applied again. Greeks
        are model values, not broker fields.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Contract</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Avg</TableHead>
          <TableHead className="text-right">Quote</TableHead>
          <TableHead className="text-right">Broker LTP</TableHead>
          <TableHead className="text-right">IV</TableHead>
          <TableHead className="text-right">Delta</TableHead>
          <TableHead className="text-right">Gamma</TableHead>
          <TableHead className="text-right">Theta/day</TableHead>
          <TableHead className="text-right">Vega</TableHead>
          <TableHead className="text-right">Broker uPnL</TableHead>
          <TableHead className="text-right">Broker net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {portfolio.positions.map((position) => {
          const greek = byId.get(position.id);
          return (
            <TableRow key={position.id}>
              <TableCell>
                <div className="font-medium">{position.tradingSymbol}</div>
                <div className="text-xs text-muted-foreground">
                  {position.optionType} {position.strike ?? "—"} · {position.expiry ? position.expiry.slice(0, 10) : "expiry n/a"}
                </div>
              </TableCell>
              <TableCell>
                <Badge className={position.side === "long" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}>
                  {position.side}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.quantity, 0)}</TableCell>
              <TableCell>{position.product}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.averagePrice)}</TableCell>
              <TableCell className="text-right">
                <div className="font-mono tabular">{formatNumber(position.quote.price)}</div>
                <Badge className={`mt-1 ${qualityClass[position.quote.quality]}`}>{qualityLabel(position.quote.quality)}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(position.brokerLastPrice)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatPercentPoints(greek?.iv)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.delta, 2)}</TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.gamma, 4)}</TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(greek?.thetaPerDay)}`}>
                {formatNumber(greek?.thetaPerDay)}
              </TableCell>
              <TableCell className="text-right font-mono tabular">{formatNumber(greek?.vegaPerPoint)}</TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(position.brokerUnrealised)}`}>
                {formatInr(position.brokerUnrealised)}
              </TableCell>
              <TableCell className={`text-right font-mono tabular ${pnlClass(position.brokerPnl)}`}>
                {formatInr(position.brokerPnl)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
