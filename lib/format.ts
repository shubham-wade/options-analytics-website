export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = formatNumber(Math.abs(value), digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function formatInr(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = formatNumber(Math.abs(value), digits);
  if (value < 0) return `−₹${formatted}`;
  if (value > 0) return `+₹${formatted}`;
  return `₹${formatted}`;
}

export function formatPercentPoints(decimal: number | null | undefined): string {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) return "—";
  return `${(decimal * 100).toFixed(2)}%`;
}

export function formatIst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "text-foreground";
  }
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}
