"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { nextHighlight } from "@/lib/stocks/parse";
import { HIGHLIGHT_HEX, type StockHighlight } from "@/lib/stocks/types";

const LABEL: Record<StockHighlight, string> = {
  green: "Green highlight",
  lime: "Lime highlight",
  amber: "Amber highlight",
  orange: "Orange highlight",
  red: "Red highlight",
};

export function StockHighlightPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: StockHighlight | null | undefined;
  disabled?: boolean;
  onChange: (next: StockHighlight) => void;
}) {
  const [tone, setTone] = useState<StockHighlight | null>(value ?? null);
  const toneRef = useRef<StockHighlight | null>(value ?? null);

  useEffect(() => {
    const next = value ?? null;
    toneRef.current = next;
    setTone(next);
  }, [value]);

  function cycle() {
    const next = nextHighlight(toneRef.current);
    toneRef.current = next;
    setTone(next);
    onChange(next);
  }

  return (
    <button
      type="button"
      aria-label={tone ? `${LABEL[tone]}. Click for the next colour.` : "Highlight. Click to mark green."}
      disabled={disabled}
      onClick={cycle}
      className="relative isolate flex h-4 w-4 items-center justify-center overflow-visible rounded-full disabled:opacity-50"
      style={tone ? ({ "--nrl-highlight": HIGHLIGHT_HEX[tone] } as CSSProperties) : undefined}
    >
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full transition-[background-color,box-shadow,border-color] duration-300",
          tone ? "nrl-highlight-dot" : "border border-muted-foreground/50 bg-transparent hover:border-muted-foreground",
        )}
      />
    </button>
  );
}
