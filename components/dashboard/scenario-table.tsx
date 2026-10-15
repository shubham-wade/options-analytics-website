"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
import { formatInr, formatNumber, formatSigned, pnlClass } from "@/lib/format";
import type { ScenarioResult } from "@/lib/scenario/engine";

export function ScenarioTable({ scenario }: { scenario: ScenarioResult }) {
  return (
    <Table>
      <TableCaption>
        Theoretical premium, change versus the current market premium, and incremental position P&L. A partial total
        means at least one contract could not be repriced.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Contract</TableHead>
          {scenario.columns.map((column) => (
            <TableHead key={column.move} className="min-w-36 text-right">
              {formatSigned(column.move, 0)}
              <div className="font-normal">Spot {formatNumber(column.spot, 0)}</div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {scenario.rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <div className="font-medium">{row.tradingSymbol}</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge
                  className={
                    row.side === "long"
                      ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300"
                      : "border-rose-600/40 text-rose-700 dark:text-rose-300"
                  }
                >
                  {row.side}
                </Badge>
                <span className="font-mono text-xs tabular text-muted-foreground">Qty {formatNumber(row.quantity, 0)}</span>
              </div>
            </TableCell>
            {row.cells.map((cell, index) => (
              <TableCell key={`${row.id}-${scenario.moves[index]}`} className="text-right font-mono text-xs tabular">
                <div>{formatNumber(cell.theoreticalPremium)}</div>
                <div className={pnlClass(cell.premiumChange)}>{formatSigned(cell.premiumChange)}</div>
                <div className={pnlClass(cell.incrementalPnl)}>{formatInr(cell.incrementalPnl)}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{cell.pricing}</div>
              </TableCell>
            ))}
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-medium">Portfolio incremental</TableCell>
          {scenario.columns.map((column) => (
            <TableCell key={column.move} className={`text-right font-mono tabular ${pnlClass(column.portfolioIncrementalPnl)}`}>
              {formatInr(column.portfolioIncrementalPnl)}
              {!column.incrementalComplete ? <div className="text-[10px] text-amber-800 dark:text-amber-300">Partial</div> : null}
            </TableCell>
          ))}
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Portfolio trade P&L</TableCell>
          {scenario.columns.map((column) => (
            <TableCell key={`trade-${column.move}`} className={`text-right font-mono tabular ${pnlClass(column.portfolioTradePnl)}`}>
              {formatInr(column.portfolioTradePnl)}
              {!column.tradeComplete ? <div className="text-[10px] text-amber-800 dark:text-amber-300">Partial</div> : null}
            </TableCell>
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
