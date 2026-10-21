"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartColors } from "@/components/dashboard/charts";
import { formatInr, formatNumber, pnlClass } from "@/lib/format";
import { expiryPayoff, signedPayoffSeries, type PayoffExtreme, type PayoffLeg, type SignedPayoffPoint } from "@/lib/pricing/payoff";

export function ExpiryPayoffChart({ legs, spot }: { legs: PayoffLeg[]; spot: number | null }) {
  const colors = useChartColors();
  const profile = expiryPayoff(legs, spot);
  const signed = profile ? signedPayoffSeries(profile.points) : [];
  const yDomain = profile ? pnlDomain(signed, profile.now?.pnl ?? null) : undefined;
  const [nowTip, setNowTip] = useState<{ x: number; y: number } | null>(null);
  if (!profile || profile.points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {profile && profile.omitted > 0
          ? "Average price is missing, so expiry profit and loss cannot be drawn."
          : "No open contract is in the model."}
      </p>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Extreme label="Maximum profit" extreme={profile.maxProfit} positive />
        <Extreme label="Maximum loss" extreme={profile.maxLoss} positive={false} />
      </div>
      <div className="relative mt-4 h-72 w-full" role="img" aria-label="Expiry profit and loss across NIFTY levels">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={signed} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="spot"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) => formatNumber(Number(value), 0)}
              stroke={colors.axis}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke={colors.axis}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={80}
              domain={yDomain}
              tickFormatter={(value) => formatNumber(Number(value), 0)}
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as SignedPayoffPoint | undefined;
                if (!active || !point || point.crossing) return null;
                return (
                  <div style={{ ...colors.tooltip, padding: "8px 10px" }}>
                    <div>NIFTY {formatNumber(point.spot, 0)}</div>
                    <div>{formatInr(point.pnl)}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke={colors.zero} />
            {profile.markSpot != null ? (
              <ReferenceLine x={profile.markSpot} stroke={colors.axis} strokeDasharray="4 4" />
            ) : null}
            {profile.now ? (
              <ReferenceLine y={profile.now.pnl} stroke={colors.axis} strokeDasharray="4 4" />
            ) : null}
            {profile.now ? (
              <ReferenceDot
                x={profile.now.spot}
                y={profile.now.pnl}
                r={6}
                fill={profile.now.pnl >= 0 ? colors.gain : colors.loss}
                stroke={colors.tooltip.color}
                label={{ value: "Now", position: "top", fill: colors.axis, fontSize: 12 }}
                shape={(props) => (
                  <NowMarker
                    cx={(props as { cx?: number }).cx}
                    cy={(props as { cy?: number }).cy}
                    fill={profile.now && profile.now.pnl >= 0 ? colors.gain : colors.loss}
                    stroke={colors.tooltip.color}
                    label={`NIFTY ${formatNumber(profile.now?.spot, 0)}, current P&L ${formatInr(profile.now?.pnl)}`}
                    onHover={setNowTip}
                  />
                )}
              />
            ) : null}
            <Area type="linear" dataKey="loss" stroke={colors.loss} fill={colors.loss} fillOpacity={0.2} baseValue={0} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Area type="linear" dataKey="gain" stroke={colors.gain} fill={colors.gain} fillOpacity={0.2} baseValue={0} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        {nowTip && profile.now ? (
          <div
            className="pointer-events-none absolute z-10"
            style={{ ...colors.tooltip, left: nowTip.x + 14, top: Math.max(4, nowTip.y - 36), padding: "8px 10px" }}
          >
            <div>NIFTY {formatNumber(profile.now.spot, 0)}</div>
            <div>Current P&L {formatInr(profile.now.pnl)}</div>
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Held to expiry and valued at the same NIFTY level, from the average price, before charges.
        {profile.now ? ` The dot marked Now is NIFTY ${formatNumber(profile.now.spot, 0)} and the open book's current P&L, ${formatInr(profile.now.pnl)}. The dashed lines mark that spot and that P&L.` : ""}
        {profile.maxProfit.kind === "unlimited" || profile.maxLoss.kind === "unlimited"
          ? " A wing that keeps rising or falling does not have a limit."
          : ""}
        {profile.omitted > 0 ? ` ${profile.omitted} ${profile.omitted === 1 ? "contract is" : "contracts are"} left out because the average price is missing.` : ""}
      </p>
    </div>
  );
}

function NowMarker({
  cx,
  cy,
  fill,
  stroke,
  label,
  onHover,
}: {
  cx?: number;
  cy?: number;
  fill: string;
  stroke: string;
  label: string;
  onHover: (point: { x: number; y: number } | null) => void;
}) {
  if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g onMouseEnter={() => onHover({ x: cx, y: cy })} onMouseLeave={() => onHover(null)} style={{ cursor: "pointer" }}>
      <title>{label}</title>
      <circle cx={cx} cy={cy} r={14} fill="transparent" />
      <circle cx={cx} cy={cy} r={6} fill={fill} stroke={stroke} strokeWidth={2} />
    </g>
  );
}

function pnlDomain(points: SignedPayoffPoint[], current: number | null): [number, number] {
  const values = points.flatMap((point) => [point.loss, point.gain].filter((value): value is number => value != null));
  values.push(0);
  if (current != null) values.push(current);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.08, 1);
  return [low - pad, high + pad];
}

function Extreme({ label, extreme, positive }: { label: string; extreme: PayoffExtreme; positive: boolean }) {
  const text = extreme.kind === "unlimited" ? "Unlimited" : formatInr(extreme.pnl);
  const tone = extreme.kind === "unlimited" ? (positive ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400") : pnlClass(extreme.pnl);
  const where = extreme.kind === "finite" && extreme.spot === 0 ? "if NIFTY expires at 0" : extreme.kind === "finite" && extreme.spot != null ? `at ${formatNumber(extreme.spot, 0)}` : null;
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl ${tone}`}>{text}</p>
      {where ? <p className="text-xs text-muted-foreground">{where}</p> : null}
    </div>
  );
}
