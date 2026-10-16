"use client";

import { useEffect, useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartColors } from "@/components/dashboard/charts";
import { Section } from "@/components/dashboard/section";
import { formatLakh } from "@/lib/format";
import { NSE_HOLIDAYS, SEEDED_DAILY_PNL, buildDailySeries, progressSummary, signedProgressSeries, type SignedPnlPoint } from "@/lib/pnl/daily";

const BROWSER_KEYS = ["nrl-daily-pnl", "nrl-cumulative-pnl", "nrl-cumulative-pnl-lakh"];

function SignDot({
  cx,
  cy,
  payload,
  series,
  fill,
}: {
  cx?: number;
  cy?: number;
  payload?: SignedPnlPoint;
  series: "loss" | "gain";
  fill: string;
}) {
  const value = payload?.[series];
  const showLoss = series === "loss" && value != null && value < 0;
  const showGain = series === "gain" && value != null && value >= 0 && !payload?.crossing;
  if (cx == null || cy == null || (!showLoss && !showGain)) return <g />;
  return <circle cx={cx} cy={cy} r={3} fill={fill} />;
}

function monthLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function DailyPnlChart() {
  const colors = useChartColors();

  useEffect(() => {
    for (const key of BROWSER_KEYS) window.localStorage.removeItem(key);
  }, []);

  const points = useMemo(() => buildDailySeries(SEEDED_DAILY_PNL), []);
  const signed = useMemo(() => signedProgressSeries(points), [points]);
  const summary = progressSummary(points);
  const monthTicks = points
    .filter((point, index) => index === 0 || point.date.slice(0, 7) !== points[index - 1]?.date.slice(0, 7))
    .map((point) => point.date);

  return (
    <Section
      title={
        <>
          P&L since 1 Apr
          <span className={summary.latest != null && summary.latest < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}>
            {summary.latest == null ? "" : ` · ${formatLakh(summary.latest)}`}
          </span>
        </>
      }
    >
      <div className="h-72 w-full" role="img" aria-label="Cumulative profit and loss from 1 April, in lakhs, plotted from 1 October to 31 March">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={signed} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, Math.max(points.length - 1, 0)]}
              ticks={monthTicks.map((date) => points.findIndex((point) => point.date === date))}
              tickFormatter={(value) => monthLabel(points[Number(value)]?.date ?? "")}
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
              width={72}
              tickFormatter={(value) => formatLakh(Number(value), 0)}
              domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as SignedPnlPoint | undefined;
                if (!active || !point || point.crossing) return null;
                return (
                  <div style={{ ...colors.tooltip, padding: "8px 10px" }}>
                    <div>{monthLabel(point.date)}</div>
                    <div>{point.pnl == null ? "Not entered" : formatLakh(point.pnl)}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke={colors.zero} />
            <Line
              type="linear"
              dataKey="loss"
              name="loss"
              stroke={colors.loss}
              strokeWidth={2}
              dot={<SignDot series="loss" fill={colors.loss} />}
              activeDot={{ r: 4, fill: colors.loss }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="gain"
              name="gain"
              stroke={colors.gain}
              strokeWidth={2}
              dot={<SignDot series="gain" fill={colors.gain} />}
              activeDot={{ r: 4, fill: colors.gain }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Each point is the total P&L from 1 April, in ₹ lakhs, not that day’s result.
        {summary.change == null ? "" : ` Since 1 Oct it has moved ${formatLakh(summary.change)}.`}{" "}
        Weekdays from 1 Oct through 31 Mar. {summary.count} days filled. NSE holidays already removed:{" "}
        {Object.entries(NSE_HOLIDAYS)
          .map(([day, name]) => `${monthLabel(day)} ${name}`)
          .join(", ")}
        . The 2027 festival list is not published yet.
      </p>
    </Section>
  );
}
