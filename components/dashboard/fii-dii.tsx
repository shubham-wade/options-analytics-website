"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartColors } from "@/components/dashboard/charts";
import { Section } from "@/components/dashboard/section";
import { formatCrore, formatSigned } from "@/lib/format";
import { flowFrame, flowLabel, flowLookbacks, type FlowNotice, type FlowPoint } from "@/lib/flows/fii-dii";

const FII_COLOR = "#38bdf8";
const DII_COLOR = "#f59e0b";

export function FiiDiiChart({ onNotices }: { onNotices: (notices: FlowNotice[]) => void }) {
  const colors = useChartColors();
  const scroller = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<FlowPoint[]>([]);
  const [viewport, setViewport] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/flows");
        if (!response.ok) throw new Error("flow request failed");
        const body = (await response.json()) as { points?: FlowPoint[]; notices?: FlowNotice[] };
        if (cancelled) return;
        setPoints(Array.isArray(body.points) ? body.points : []);
        onNotices(Array.isArray(body.notices) ? body.notices : []);
        setNote(null);
      } catch {
        if (cancelled) return;
        setNote("FII/DII could not be loaded.");
        onNotices([
          {
            key: "fii-load-failed",
            title: "FII/DII not fetched",
            detail: "The daily cash-flow file could not be refreshed.",
          },
        ]);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onNotices]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setViewport(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [points.length]);

  const frame = useMemo(() => flowFrame(points), [points]);
  const lookbacks = useMemo(() => flowLookbacks(points), [points]);
  const chartWidth = viewport > 0 ? Math.max(viewport, (points.length / frame.count) * viewport) : undefined;

  useEffect(() => {
    const node = scroller.current;
    if (!node || !chartWidth || points.length === 0) return;
    node.scrollLeft = frame.start * (chartWidth / points.length);
  }, [points.length, viewport, chartWidth, frame.start]);
  const monthTicks = useMemo(
    () =>
      points
        .filter((point, index) => index === 0 || point.date.slice(0, 7) !== points[index - 1]?.date.slice(0, 7))
        .map((point) => point.date),
    [points],
  );

  return (
    <Section
      title="FII / DII cash flow"
      aside={
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FII_COLOR }} />
            FII
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DII_COLOR }} />
            DII
          </span>
        </div>
      }
    >
      {lookbacks.length > 0 ? (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {lookbacks.map((window) => (
            <div key={window.sessions} className="rounded-md border border-border px-3 py-2 text-xs">
              <p className="text-muted-foreground">
                {window.sessions} sessions · {flowLabel(window.from)}–{flowLabel(window.to)}
                {window.counted < window.sessions ? ` · ${window.counted} saved` : ""}
              </p>
              <p className="mt-1 font-mono" style={{ color: FII_COLOR }}>FII {formatCrore(window.fii)}</p>
              <p className="font-mono" style={{ color: DII_COLOR }}>DII {formatCrore(window.dii)}</p>
            </div>
          ))}
        </div>
      ) : null}
      <div ref={scroller} className="overflow-x-auto">
        <div className="h-80" style={chartWidth ? { width: chartWidth } : undefined} role="img" aria-label="FII and DII net cash flow from July to March. The frame opens on the last 90 days.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 16, right: 12, left: 0, bottom: 0 }} barGap={1} barCategoryGap="8%">
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={monthTicks}
                tickFormatter={flowLabel}
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
                width={64}
                tickFormatter={(value) => formatSigned(Number(value), 0)}
                domain={[(dataMin: number) => Math.min(0, dataMin), (dataMax: number) => Math.max(0, dataMax)]}
              />
              <Tooltip
                cursor={{ fill: colors.grid }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as FlowPoint | undefined;
                  if (!active || !point) return null;
                  const combined = point.fii == null || point.dii == null ? null : point.fii + point.dii;
                  return (
                    <div style={{ ...colors.tooltip, padding: "8px 10px" }}>
                      <div>{flowLabel(point.date)}</div>
                      <div style={{ color: FII_COLOR }}>FII {formatCrore(point.fii)}</div>
                      <div style={{ color: DII_COLOR }}>DII {formatCrore(point.dii)}</div>
                      <div>Combined {formatCrore(combined)}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke={colors.zero} />
              {[...lookbacks].reverse().map((window) => (
                <ReferenceArea
                  key={window.sessions}
                  x1={window.from}
                  x2={window.to}
                  fill={colors.axis}
                  fillOpacity={window.sessions === 5 ? 0.16 : window.sessions === 10 ? 0.12 : window.sessions === 20 ? 0.08 : 0.04}
                  ifOverflow="hidden"
                />
              ))}
              <Bar dataKey="fii" name="FII" fill={FII_COLOR} />
              <Bar dataKey="dii" name="DII" fill={DII_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Net cash flow in ₹ crore. Blue is FII and amber is DII. The shaded bands are the last 5, 10, 20 and 40 trading sessions back from the newest saved day, and the figures above are those sums. NSE publishes the provisional print between 5:30 and 6:30 PM IST. The frame opens on the last 90 days. Scroll sideways for July through March.
        {note ? ` ${note}` : ""}
      </p>
    </Section>
  );
}
