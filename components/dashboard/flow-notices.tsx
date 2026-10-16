"use client";

import type { FlowNotice } from "@/lib/flows/fii-dii";

export function FlowNotices({
  notices,
  onDismiss,
  onDismissAll,
}: {
  notices: FlowNotice[];
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onDismissAll}>
          Dismiss flow notices
        </button>
      </div>
      {notices.map((notice) => (
        <article key={notice.key} className="rounded-lg border-l-4 border-amber-800 bg-amber-500 px-3 py-2 text-amber-950 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{notice.title}</p>
            <button type="button" className="text-xs opacity-80" onClick={() => onDismiss(notice.key)} aria-label={`Dismiss ${notice.title}`}>
              Close
            </button>
          </div>
          <p className="mt-1 text-sm">{notice.detail}</p>
        </article>
      ))}
    </div>
  );
}
