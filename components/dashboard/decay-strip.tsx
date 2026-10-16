import { Section } from "@/components/dashboard/section";
import { formatInr, pnlClass } from "@/lib/format";
import type { DecayPoint } from "@/lib/scenario/engine";

export function DecayStrip({ points }: { points: DecayPoint[] }) {
  return (
    <Section title="If NIFTY stays here">
        <div className="grid grid-cols-3 gap-3">
          {points.map((point) => (
            <div key={point.horizonDays}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {point.horizonDays} calendar {point.horizonDays === 1 ? "day" : "days"}
              </p>
              <p className={`mt-1 font-mono text-xl tabular ${pnlClass(point.incrementalPnl)}`}>{formatInr(point.incrementalPnl)}</p>
              {!point.complete ? <p className="text-[10px] text-amber-800 dark:text-amber-300">Partial</p> : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Incremental P&L if the spot and implied volatility stay where they are. This is a model view. No order is sent.
        </p>
    </Section>
  );
}
