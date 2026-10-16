import type { ReactNode } from "react";
import { LiveDot } from "@/components/dashboard/live-dot";

export function LabHeader({
  kicker,
  live,
  refreshing = false,
  children,
}: {
  kicker: string;
  live: boolean;
  refreshing?: boolean;
  children: ReactNode;
}) {
  return (
    <header className="lab-header">
      {refreshing ? <span className="lab-refresh-bar" aria-hidden="true" /> : null}
      <div className="mx-auto max-w-[1440px] px-4 py-3 md:px-6">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-teal-800 dark:text-teal-300/80">{kicker}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            NIFTY Risk Lab
            <LiveDot live={live} />
          </h1>
          <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
        </div>
      </div>
    </header>
  );
}
