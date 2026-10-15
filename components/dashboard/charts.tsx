"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScenarioResult } from "@/lib/scenario/engine";

const tooltipStyle = {
  background: "#10161d",
  border: "1px solid #243041",
  borderRadius: 8,
  fontSize: 12,
};

export function PortfolioPnlChart({ scenario }: { scenario: ScenarioResult }) {
  const data = scenario.columns.map((column) => ({
    label: `${column.move > 0 ? "+" : ""}${column.move}`,
    pnl: column.portfolioIncrementalPnl,
  }));
  return (
    <div className="h-72 w-full" role="img" aria-label="Portfolio incremental P and L across NIFTY scenarios">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={72} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatAxis(Number(value)), "Incremental P&L"]} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
          <Line type="monotone" dataKey="pnl" stroke="#2dd4bf" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ContributionChart({
  scenario,
  move,
}: {
  scenario: ScenarioResult;
  move: number;
}) {
  const index = scenario.moves.indexOf(move);
  const column = index >= 0 ? index : 0;
  const data = scenario.rows.map((row) => ({
    symbol: row.tradingSymbol,
    pnl: row.cells[column]?.incrementalPnl ?? null,
  }));
  return (
    <div className="h-72 w-full" role="img" aria-label="Position contribution to scenario P and L">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
          <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="symbol" stroke="#94a3b8" fontSize={11} width={132} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatAxis(Number(value)), "Incremental P&L"]} />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
          <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.symbol} fill={(entry.pnl ?? 0) >= 0 ? "#34d399" : "#fb7185"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatAxis(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
