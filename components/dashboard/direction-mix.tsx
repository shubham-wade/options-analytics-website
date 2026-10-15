import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { directionMix, type DirectionPosition } from "@/lib/risk/direction";
import type { PositionGreeks } from "@/lib/scenario/engine";

export function DirectionMix({
  positions,
  greeks,
}: {
  positions: DirectionPosition[];
  greeks: PositionGreeks[];
}) {
  const mix = directionMix(positions, greeks);
  if (mix.basis === "empty") return null;

  const bullishPercent = mix.bullishPercent ?? 0;
  const bearishPercent = mix.bearishPercent ?? 0;
  const stance =
    bullishPercent >= 55 ? "Net bullish" : bearishPercent >= 55 ? "Net bearish" : "Roughly balanced";
  const stanceClass =
    stance === "Net bullish"
      ? "text-emerald-700 dark:text-emerald-400"
      : stance === "Net bearish"
        ? "text-rose-700 dark:text-rose-400"
        : "text-muted-foreground";
  const bullishWidth = `${(mix.bullishShare ?? 0) * 100}%`;
  const bearishWidth = `${(1 - (mix.bullishShare ?? 0)) * 100}%`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Directional mix</CardTitle>
          <p className={`text-sm font-medium ${stanceClass}`}>{stance}</p>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="flex h-3 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Bullish ${bullishPercent} percent, bearish ${bearishPercent} percent`}
        >
          <div className="h-full bg-emerald-600" style={{ width: bullishWidth }} />
          <div className="h-full bg-rose-600" style={{ width: bearishWidth }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-4 text-sm">
          <span className="text-emerald-700 dark:text-emerald-400">Bullish {bullishPercent}%</span>
          <span className="text-rose-700 dark:text-rose-400">Bearish {bearishPercent}%</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {mix.basis === "delta"
            ? `${mix.bullishCount} bullish ${mix.bullishCount === 1 ? "position" : "positions"}, delta ${formatNumber(mix.bullishDelta, 1)}. ${mix.bearishCount} bearish ${mix.bearishCount === 1 ? "position" : "positions"}, delta ${formatNumber(mix.bearishDelta, 1)}.`
            : `${mix.bullishCount} bullish ${mix.bullishCount === 1 ? "position" : "positions"} and ${mix.bearishCount} bearish ${mix.bearishCount === 1 ? "position" : "positions"}. Delta weighting appears once implied volatility is calibrated.`}
          {mix.missingDelta > 0
            ? ` ${mix.missingDelta} ${mix.missingDelta === 1 ? "contract has" : "contracts have"} no model delta and ${mix.missingDelta === 1 ? "is" : "are"} omitted from the bar.`
            : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Long calls and short puts are bullish. Long puts and short calls are bearish. Each Delta figure is the model delta multiplied by quantity, so a larger quantity takes a larger share of the bar.
        </p>
      </CardContent>
    </Card>
  );
}
