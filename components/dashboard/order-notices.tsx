"use client";

import type { OrderNotice, OrderNoticeKind } from "@/lib/kite/orders";

const tone: Record<OrderNoticeKind, string> = {
  new: "border-teal-800 bg-teal-600 text-white",
  modified: "border-amber-800 bg-amber-500 text-amber-950",
  filled: "border-sky-800 bg-sky-600 text-white",
  completed: "border-emerald-900 bg-emerald-600 text-white",
  cancelled: "border-rose-900 bg-rose-600 text-white",
  rejected: "border-red-950 bg-red-700 text-white",
};

export interface ShownOrderNotice extends OrderNotice {
  at: string;
}

export function OrderNotices({
  notices,
  onDismiss,
  onDismissAll,
}: {
  notices: ShownOrderNotice[];
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="fixed right-4 top-28 z-50 flex w-[min(100vw-2rem,22rem)] flex-col gap-2" aria-live="assertive">
      <div className="flex justify-end">
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onDismissAll}>
          Dismiss all
        </button>
      </div>
      {notices.map((notice) => (
        <article key={notice.key} className={`rounded-lg border-l-4 px-3 py-2 shadow-lg ${tone[notice.kind]}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{notice.title}</p>
            <button type="button" className="text-xs opacity-80" onClick={() => onDismiss(notice.key)} aria-label={`Dismiss ${notice.title}`}>
              Close
            </button>
          </div>
          <p className="mt-1">
            <span
              className={`inline-block rounded px-1.5 py-0.5 font-mono text-sm font-semibold ${
                notice.side === "BUY"
                  ? "bg-emerald-100 text-emerald-900"
                  : notice.side === "SELL"
                    ? "bg-rose-100 text-rose-900"
                    : "bg-white/80 text-slate-900"
              }`}
            >
              {notice.symbol}
            </span>
          </p>
          <p className="mt-1 text-sm opacity-95">{notice.detail}</p>
        </article>
      ))}
    </div>
  );
}

/** A short tone. Browsers may ignore it until the page has been clicked. */
export function playOrderChime(): void {
  const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Context = window.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Context) return;
  const context = new Context();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 740;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.stop(context.currentTime + 0.24);
  oscillator.onended = () => void context.close();
}
