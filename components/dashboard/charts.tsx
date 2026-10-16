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
import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/format";
import type { ScenarioResult } from "@/lib/scenario/engine";
import { THEME_EVENT } from "@/components/theme/theme-toggle";

interface ChartColors {
  line: string;
  axis: string;
  grid: string;
  zero: string;
  gain: string;
  loss: string;
  tooltip: { background: string; border: string; color: string; borderRadius: number; fontSize: number };
}

const fallback: ChartColors = {
  line: "#2dd4bf",
  axis: "#94a3b8",
  grid: "rgba(255,255,255,0.06)",
  zero: "rgba(255,255,255,0.25)",
  gain: "#34d399",
  loss: "#fb7185",
  tooltip: { background: "#10161d", border: "1px solid #243041", color: "#f8fafc", borderRadius: 8, fontSize: 12 },
};

function readChartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallbackValue: string) => style.getPropertyValue(name).trim() || fallbackValue;
  return {
    line: value("--chart-line", fallback.line),
    axis: value("--chart-axis", fallback.axis),
    grid: value("--chart-grid", fallback.grid),
    zero: value("--chart-zero", fallback.zero),
    gain: value("--chart-gain", fallback.gain),
    loss: value("--chart-loss", fallback.loss),
    tooltip: {
      background: value("--tooltip-bg", fallback.tooltip.background),
      border: `1px solid ${value("--tooltip-border", "#243041")}`,
      color: value("--tooltip-fg", fallback.tooltip.color),
      borderRadius: 8,
      fontSize: 12,
    },
  };
}

export function useChartColors() {
  const [colors, setColors] = useState<ChartColors>(fallback);
  useEffect(() => {
    const read = () => setColors(readChartColors());
    read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);
  return colors;
}

export function PortfolioPnlChart({ scenario }: { scenario: ScenarioResult }) {
  const colors = useChartColors();
  const data = [...scenario.columns]
    .sort((left, right) => left.move - right.move)
    .map((column) => ({
      move: column.move,
      pnl: column.portfolioIncrementalPnl,
    }));
  return (
    <div>
      <div className="h-72 w-full" role="img" aria-label="Portfolio incremental P and L across NIFTY scenarios">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="move"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={data.map((point) => point.move)}
              tickFormatter={(value) => (Number(value) > 0 ? `+${value}` : String(value))}
              stroke={colors.axis}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke={colors.axis} fontSize={12} tickLine={false} axisLine={false} width={72} />
            <Tooltip contentStyle={colors.tooltip} formatter={(value) => [formatAxis(Number(value)), "Incremental P&L"]} />
            <ReferenceLine y={0} stroke={colors.zero} />
            {scenario.breakevens?.map((point) => (
              <ReferenceLine key={`${point.fromMove}-${point.toMove}-${point.move}`} x={point.move} stroke={colors.axis} strokeDasharray="4 4" />
            ))}
            <Line type="monotone" dataKey="pnl" stroke={colors.line} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{breakevenCaption(scenario)}</p>
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
  const colors = useChartColors();
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
          <CartesianGrid stroke={colors.grid} horizontal={false} />
          <XAxis type="number" stroke={colors.axis} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="symbol" stroke={colors.axis} fontSize={11} width={132} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={colors.tooltip} formatter={(value) => [formatAxis(Number(value)), "Incremental P&L"]} />
          <ReferenceLine x={0} stroke={colors.zero} />
          <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.symbol} fill={(entry.pnl ?? 0) >= 0 ? colors.gain : colors.loss} />
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

function breakevenCaption(scenario: ScenarioResult): string {
  const horizon =
    scenario.horizonDays === 0
      ? "right now"
      : `over ${scenario.horizonDays} calendar ${scenario.horizonDays === 1 ? "day" : "days"}`;
  if ((scenario.breakevens ?? []).length > 0) {
    const list = (scenario.breakevens ?? []).map((point) => {
      const rounded = Math.round(point.move);
      const signed = rounded > 0 ? `+${rounded}` : String(rounded);
      return `${formatNumber(point.spot, 0)} (${signed} points)`;
    });
    return `Breakeven near ${list.join(" and ")} ${horizon}.`;
  }
  const values = scenario.columns
    .filter((column) => column.incrementalComplete && column.portfolioIncrementalPnl !== null)
    .map((column) => column.portfolioIncrementalPnl as number);
  if (values.length > 0 && values.every((value) => value > 0)) {
    return `Incremental P&L stays positive across these moves ${horizon}.`;
  }
  if (values.length > 0 && values.every((value) => value < 0)) {
    return `Incremental P&L stays negative across these moves ${horizon}.`;
  }
  return `No breakeven inside these moves ${horizon}.`;
}
