import type {
  StockDividend,
  StockFundamentals,
  StockGrowth,
  StockHolding,
  StockNewsItem,
  StockNote,
  StockPeer,
  StockQuarter,
  StockResultDate,
  StockYear,
} from "@/lib/stocks/types";

export interface StockReadingInput {
  price: { last: number | null; yearLow: number | null; yearHigh: number | null };
  fundamentals: Pick<StockFundamentals, "pe" | "industryPe" | "dividendYield" | "debtToEquity" | "roe">;
  years: StockYear[];
  quarters: StockQuarter[];
  growth: StockGrowth | null;
  holdings: StockHolding[];
  peers: StockPeer[];
  dividends: StockDividend[];
  results: StockResultDate[];
  news: StockNewsItem[];
  /** Asia/Kolkata day the snapshot is saved, YYYY-MM-DD. */
  asOf: string;
}

export function netMargin(profit: number | null, revenue: number | null): number | null {
  if (profit == null || revenue == null || !Number.isFinite(profit) || !Number.isFinite(revenue) || revenue === 0) return null;
  return (profit / revenue) * 100;
}

function signedPercent(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value > 0) return `+${abs}%`;
  if (value < 0) return `−${abs}%`;
  return `${abs}%`;
}

function percent(value: number, digits = 2): string {
  const abs = Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (value < 0) return `−${abs}%`;
  return `${abs}%`;
}

function crore(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} crore`;
}

function rupee(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function percentChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function yearAgoQuarter(label: string): string | null {
  const match = /^([A-Za-z]{3}) '(\d{2})$/.exec(label.trim());
  if (!match) return null;
  return `${match[1]} '${String(Number(match[2]) - 1).padStart(2, "0")}`;
}

function priceNote(input: StockReadingInput): StockNote | null {
  const { last, yearLow, yearHigh } = input.price;
  const fromLow = percentChange(yearLow, last);
  const fromHigh = percentChange(yearHigh, last);
  if (fromLow == null || fromHigh == null) return null;
  return {
    heading: "Price",
    text: `Last is ${signedPercent(fromLow)} from the 52-week low and ${signedPercent(fromHigh)} from the 52-week high.`,
  };
}

function resultsNote(input: StockReadingInput): StockNote | null {
  const sentences: string[] = [];
  const latest = input.quarters[input.quarters.length - 1];
  if (latest?.revenue != null && latest.profit != null) {
    const margin = netMargin(latest.profit, latest.revenue);
    const priorLabel = yearAgoQuarter(latest.quarter);
    const prior = priorLabel ? input.quarters.find((row) => row.quarter === priorLabel) : undefined;
    let line = `In ${latest.quarter}, revenue is ${crore(latest.revenue)} and profit is ${crore(latest.profit)}`;
    line += margin == null ? "." : `, a net margin of ${percent(margin, 1)}.`;
    if (prior?.revenue != null && prior.profit != null) {
      const priorMargin = netMargin(prior.profit, prior.revenue);
      line += ` In ${prior.quarter} those figures were ${crore(prior.revenue)}, ${crore(prior.profit)}`;
      line += priorMargin == null ? "." : `, and ${percent(priorMargin, 1)}.`;
    }
    sentences.push(line);
  }
  const year = input.years[input.years.length - 1];
  const previous = input.years[input.years.length - 2];
  if (year?.revenue != null && year.profit != null) {
    let line = `The latest full year, ${year.year}, has revenue of ${crore(year.revenue)} and profit of ${crore(year.profit)}.`;
    if (previous?.revenue != null && previous.profit != null) {
      line += ` The year before, revenue was ${crore(previous.revenue)} and profit was ${crore(previous.profit)}.`;
    }
    sentences.push(line);
  }
  if (sentences.length === 0) return null;
  return { heading: "Results", text: sentences.join(" ") };
}

function growthNote(growth: StockGrowth | null): StockNote | null {
  if (!growth) return null;
  const parts: string[] = [];
  if (growth.revenueOneYear != null) parts.push(`trailing one-year revenue growth is ${percent(growth.revenueOneYear)}`);
  if (growth.revenueThreeYear != null) parts.push(`three-year revenue CAGR is ${percent(growth.revenueThreeYear)}`);
  if (growth.profitOneYear != null) parts.push(`trailing one-year profit growth is ${percent(growth.profitOneYear)}`);
  if (growth.profitThreeYear != null) parts.push(`three-year profit CAGR is ${percent(growth.profitThreeYear)}`);
  if (parts.length === 0) return null;
  const text = parts.join(", ").replace(/^./, (letter) => letter.toUpperCase());
  return { heading: "Growth", text: `${text}.` };
}

function plain(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valuationNote(fundamentals: StockReadingInput["fundamentals"]): StockNote | null {
  const sentences: string[] = [];
  if (fundamentals.pe != null && fundamentals.industryPe != null) {
    sentences.push(`P/E is ${plain(fundamentals.pe)} and the industry P/E is ${plain(fundamentals.industryPe)}.`);
  } else if (fundamentals.pe != null) {
    sentences.push(`P/E is ${plain(fundamentals.pe)}.`);
  } else if (fundamentals.industryPe != null) {
    sentences.push(`The industry P/E is ${plain(fundamentals.industryPe)}.`);
  }
  if (fundamentals.dividendYield != null) sentences.push(`Dividend yield is ${percent(fundamentals.dividendYield)}.`);
  if (fundamentals.debtToEquity != null) sentences.push(`Debt to equity is ${plain(fundamentals.debtToEquity)}.`);
  if (fundamentals.roe != null) sentences.push(`ROE is ${percent(fundamentals.roe)}.`);
  if (sentences.length === 0) return null;
  return { heading: "Valuation", text: sentences.join(" ") };
}

function shareholdingNote(holdings: StockHolding[]): StockNote | null {
  const first = holdings[0];
  const last = holdings[holdings.length - 1];
  if (!first || !last || first.quarter === last.quarter) return null;
  const bits: string[] = [];
  if (first.foreignInstitutions != null && last.foreignInstitutions != null) {
    bits.push(`foreign institutions went from ${percent(first.foreignInstitutions)} to ${percent(last.foreignInstitutions)}`);
  }
  if (first.mutualFunds != null && last.mutualFunds != null) {
    bits.push(`mutual funds went from ${percent(first.mutualFunds)} to ${percent(last.mutualFunds)}`);
  }
  if (bits.length === 0) return null;
  return {
    heading: "Shareholding",
    text: `From ${first.quarter} to ${last.quarter}, ${bits.join(" and ")}.`,
  };
}

function peerNote(peers: StockPeer[], pe: number | null, industryPe: number | null): StockNote | null {
  const rated = peers.filter((peer) => peer.pe != null);
  if (rated.length === 0 && pe == null) return null;
  const sentences: string[] = [];
  if (rated.length > 0) {
    const sorted = [...rated].sort((a, b) => (a.pe ?? 0) - (b.pe ?? 0));
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    sentences.push(
      `Groww lists ${peers.length} peers. P/E on that list runs from ${plain(low?.pe ?? 0)} (${low?.name}) to ${plain(high?.pe ?? 0)} (${high?.name}).`,
    );
  }
  if (pe != null) sentences.push(`This company’s P/E is ${plain(pe)}.`);
  if (industryPe != null) sentences.push(`The industry P/E is ${plain(industryPe)}.`);
  return { heading: "Peers", text: sentences.join(" ") };
}

function dividendNote(dividends: StockDividend[], asOf: string): StockNote | null {
  if (dividends.length === 0) return null;
  const upcoming = dividends.filter((row) => row.exDate >= asOf).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const next = upcoming[0] ?? dividends[0];
  if (!next) return null;
  const kind = next.kind ? ` (${next.kind})` : "";
  const when = next.exDate >= asOf ? "next" : "latest";
  return {
    heading: "Dividend",
    text: `The ${when} dividend on file is ${rupee(next.amount)} a share${kind}, ex date ${dayLabel(next.exDate)}.`,
  };
}

function calendarNote(results: StockResultDate[], news: StockNewsItem[]): StockNote | null {
  const sentences: string[] = [];
  const latest = results[0];
  if (latest) {
    const known: Record<string, string> = {
      "Quarterly Result": "a quarterly result",
      "Annual Result": "an annual result",
    };
    sentences.push(`The latest results date on file is ${dayLabel(latest.date)}, ${known[latest.title] ?? latest.title}.`);
  }
  const headline = news[0];
  if (headline) {
    sentences.push(
      `${news.length} headlines are saved. The newest, from ${headline.source} on ${dayLabel(headline.publishedAt)}, reads: ${headline.title.endsWith(".") ? headline.title : `${headline.title}.`}`,
    );
  }
  if (sentences.length === 0) return null;
  return { heading: "Calendar", text: sentences.join(" ") };
}

/** A reading of the saved figures. Each sentence states a number from this snapshot. */
export function stockNotes(input: StockReadingInput): StockNote[] {
  return [
    priceNote(input),
    resultsNote(input),
    growthNote(input.growth),
    valuationNote(input.fundamentals),
    shareholdingNote(input.holdings),
    peerNote(input.peers, input.fundamentals.pe, input.fundamentals.industryPe),
    dividendNote(input.dividends, input.asOf),
    calendarNote(input.results, input.news),
  ].filter((note): note is StockNote => note != null);
}
