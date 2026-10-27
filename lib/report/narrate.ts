import { formatNumber } from "@/lib/format";
import type { FuturesRead, IndexContribution, IndexPrint, SectorMove, VixPrint } from "@/lib/report/types";

export interface Narration {
  nifty: IndexPrint | null;
  bankNifty: IndexPrint | null;
  vix: VixPrint | null;
  sectors: SectorMove[];
  contributors: IndexContribution | null;
  cash: { today: { fii: number; dii: number } | null };
  participants: { name: string; futureIndexLongChange: number | null; futureIndexShortChange: number | null; longRatio: number | null }[];
  futures: FuturesRead | null;
  chains: { expiry: string; pcr: number | null; topCalls: { strike: number }[]; topPuts: { strike: number }[] }[];
}

const SECTOR_LABEL: Record<string, string> = {
  "NIFTY IT": "IT",
  "NIFTY FINANCIAL SERVICES": "financials",
  "NIFTY PSU BANK": "PSU banks",
  "NIFTY AUTO": "autos",
  "NIFTY METAL": "metals",
  "NIFTY PHARMA": "pharma",
  "NIFTY FMCG": "FMCG",
  "NIFTY ENERGY": "energy",
  "NIFTY REALTY": "realty",
  "NIFTY MEDIA": "media",
  "NIFTY INFRA": "infrastructure",
  "NIFTY HEALTHCARE": "healthcare",
};

const MONTHS: Record<string, string> = {
  Jan: "January",
  Feb: "February",
  Mar: "March",
  Apr: "April",
  May: "May",
  Jun: "June",
  Jul: "July",
  Aug: "August",
  Sep: "September",
  Oct: "October",
  Nov: "November",
  Dec: "December",
};

/** A few paragraphs in ordinary language. Every figure comes from the saved report. */
export function narrateReport(report: Narration, options?: { cashPending?: boolean }): string[] {
  const day = dayParagraph(report);
  const people = peopleParagraph(report, options?.cashPending ?? false);
  const market = marketParagraph(report);
  return [day, people, market].filter((paragraph): paragraph is string => Boolean(paragraph));
}

function dayParagraph(report: Narration): string | null {
  if (!report.nifty) return "The index prices for this session did not load, so there is no reading of the day yet.";
  const sentences = [
    indexClose(report.nifty),
    rangeStory(report.nifty),
    breadth(report.nifty),
    breadthMeaning(report.nifty),
    bankStory(report.bankNifty),
    bankMeaning(report),
    sectorStory(report.sectors),
    stockStory(report.contributors),
  ];
  return join(sentences);
}

function peopleParagraph(report: Narration, cashPending: boolean): string | null {
  const cash = cashStory(report, cashPending);
  const books = bookStory(report.participants);
  const positioning = positioningStory(report.futures);
  return join([cash, books, positioning]);
}

function marketParagraph(report: Narration): string | null {
  return join([chainStory(report), vixStory(report.vix), understanding(report)]);
}

function indexClose(print: IndexPrint): string {
  const name = print.name === "NIFTY 50" ? "NIFTY" : print.name;
  if (print.change === 0) return `${name} finished unchanged at ${formatNumber(print.close)}.`;
  const direction = print.change > 0 ? "up" : "down";
  return `${name} finished at ${formatNumber(print.close)}, ${direction} ${points(print.change)} points, or ${formatNumber(Math.abs(print.percentChange), 2)}%.`;
}

function rangeStory(print: IndexPrint): string | null {
  const range = `The day’s range was ${formatNumber(print.low)} to ${formatNumber(print.high)}.`;
  const where =
    print.closingLocation == null
      ? null
      : print.closingLocation >= 0.66
        ? "The close was near the high of that range."
        : print.closingLocation <= 0.4
          ? "The close was in the lower part of that range."
          : "The close was around the middle of that range.";
  const gap = print.gap;
  if (gap != null && gap >= 20 && print.change < 0) {
    return `It opened ${formatNumber(gap, 0)} points above the previous close and gave that up. ${range}${where ? ` ${where}` : ""}`;
  }
  if (gap != null && gap <= -20 && print.change > 0) {
    return `It opened ${formatNumber(Math.abs(gap), 0)} points below the previous close and recovered. ${range}${where ? ` ${where}` : ""}`;
  }
  if (gap != null && Math.abs(gap) >= 20) {
    const side = gap > 0 ? "above" : "below";
    return `It opened ${formatNumber(Math.abs(gap), 0)} points ${side} the previous close. ${range}${where ? ` ${where}` : ""}`;
  }
  return where ? `${range} ${where}` : range;
}

function breadth(print: IndexPrint): string | null {
  if (print.advances == null || print.declines == null) return null;
  return `In the index itself, ${print.advances} stocks rose and ${print.declines} fell.`;
}

function bankStory(print: IndexPrint | null): string | null {
  if (!print) return null;
  if (print.change === 0) return "Bank Nifty finished unchanged.";
  const direction = print.change > 0 ? "up" : "down";
  return `Bank Nifty was ${direction} ${formatNumber(Math.abs(print.change), 0)} points, at ${formatNumber(print.close, 0)}.`;
}

function sectorStory(sectors: SectorMove[]): string | null {
  if (sectors.length === 0) return null;
  const ranked = [...sectors].sort((left, right) => right.percentChange - left.percentChange);
  const best = ranked[0];
  const worst = ranked.slice(-3).filter((sector) => sector.percentChange < -0.2).reverse();
  const sentences: string[] = [];
  if (best && best.percentChange > 0.2) {
    sentences.push(`${labelSector(best.name)} rose ${formatNumber(best.percentChange)}%.`);
  }
  if (worst.length > 0) {
    const names = list(worst.map((sector) => labelSector(sector.name)));
    const lead = names.charAt(0).toUpperCase() + names.slice(1);
    sentences.push(`${lead} ${worst.length === 1 ? "was" : "were"} among the weaker groups.`);
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

function stockStory(contribution: IndexContribution | null): string | null {
  if (!contribution) return null;
  const lift = contribution.pullers.slice(0, 3);
  const drag = contribution.draggers.slice(0, 3);
  const sentences: string[] = [];
  if (lift.length > 0) sentences.push(`${list(lift.map((row) => row.symbol))} added the most points to the index.`);
  if (drag.length > 0) sentences.push(`${list(drag.map((row) => row.symbol))} took the most points out.`);
  const lead = lift[0];
  const laggard = drag[0];
  if (lead && laggard) {
    sentences.push(
      `A point is an estimate of how many NIFTY points came from that stock: its free-float weight at the previous close, times its own price change. ${lead.symbol} accounted for ${spokenNumber(lead.points)} points, and ${laggard.symbol} took out ${spokenNumber(laggard.points)}.`,
    );
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

function breadthMeaning(print: IndexPrint): string | null {
  if (print.advances == null || print.declines == null || print.change === 0) return null;
  if (print.change < 0 && print.declines > print.advances) {
    return "More stocks fell than rose, so the decline was broad inside the fifty. The headline points are the whole index. The advance and decline counts say how widely that move was shared.";
  }
  if (print.change > 0 && print.advances > print.declines) {
    return "More stocks rose than fell, so the rise was broad inside the fifty. The headline points are the whole index. The advance and decline counts say how widely that move was shared.";
  }
  if (print.change < 0 && print.advances > print.declines) {
    return "The index fell even though more stocks rose, so the damage was concentrated in the heavier names.";
  }
  if (print.change > 0 && print.declines > print.advances) {
    return "The index rose even though more stocks fell, so the rise was carried by the heavier names.";
  }
  return null;
}

function bankMeaning(report: Narration): string | null {
  if (!report.nifty || !report.bankNifty || report.nifty.change >= 0 || report.bankNifty.change >= 0) return null;
  if (report.bankNifty.percentChange >= report.nifty.percentChange) return null;
  return "Bank Nifty falling further than NIFTY means the financial heavyweights did more of the damage than the headline index shows.";
}

function cashStory(report: Narration, cashPending: boolean): string | null {
  const today = report.cash.today;
  if (!today) {
    return cashPending
      ? "Foreign and domestic cash figures are not in yet. They often show up between 5:30 and 6:30 in the evening."
      : "Foreign and domestic cash figures for this session were not saved.";
  }
  const fii = boughtSold(today.fii);
  const dii = boughtSold(today.dii);
  const lead = `In the cash market, foreign institutions ${fii} ${crore(today.fii)} and domestic institutions ${dii} ${crore(today.dii)}.`;
  const meaning = " A crore figure here is net cash bought minus cash sold for that group. It is stock-market flow, not a futures position, and it is not a prediction.";
  if (today.fii > 0 && today.dii > 0 && report.nifty && report.nifty.change < 0) {
    return `${lead} Both were buyers, and the index still closed lower. The cash file only names those two. When the heavyweights fall, their buying does not have to lift the index.${meaning}`;
  }
  if (today.fii < 0 && today.dii < 0 && report.nifty && report.nifty.change > 0) {
    return `${lead} Both were sellers, and the index still closed higher.${meaning}`;
  }
  return `${lead}${meaning}`;
}

function bookStory(rows: Narration["participants"]): string | null {
  const order = ["Client", "Pro", "FII"] as const;
  const sentences = order.flatMap((name) => {
    const row = rows.find((participant) => participant.name === name);
    if (!row) return [];
    const changes = [contractChange(row.futureIndexLongChange, "long"), contractChange(row.futureIndexShortChange, "short")].filter(
      (part): part is string => Boolean(part),
    );
    if (changes.length === 0) return [];
    const who = name === "Client" ? "In index futures, clients" : name === "Pro" ? "Proprietary desks" : "In that same futures file, foreign institutions";
    const ratio =
      name === "FII" && row.longRatio != null
        ? ` Their futures book is about ${formatNumber(row.longRatio * 100, 0)}% long, so most of those contracts are short.`
        : "";
    return [`${who} ${list(changes)}.${ratio}`];
  });
  if (sentences.length === 0) return null;
  return `${sentences.join(" ")} A long contract gains when the index rises, and a short contract gains when it falls. These counts are the change from the previous participant file.`;
}

function positioningStory(futures: FuturesRead | null): string | null {
  if (!futures || futures.oiChange == null || futures.oiChange === 0 || futures.priceChange === 0) return null;
  const index = futures.priceChange > 0 ? "rose" : "fell";
  const interest = futures.oiChange > 0 ? "rose" : "fell";
  const usual =
    futures.priceChange > 0 && futures.oiChange > 0
      ? "fresh long positions"
      : futures.priceChange < 0 && futures.oiChange > 0
        ? "fresh short positions"
        : futures.priceChange > 0 && futures.oiChange < 0
          ? "shorts being closed"
          : "longs being closed";
  return `Index-futures open interest ${interest} while the index ${index}. Open interest is the number of contracts still open. That pattern is usually read as ${usual}. The reading describes how the book changed. It is not a prediction of the next session.`;
}

function chainStory(report: Narration): string | null {
  const chain = report.chains[0];
  if (!chain) return null;
  const expiry = expiryLabel(chain.expiry);
  const call = chain.topCalls[0]?.strike;
  const put = chain.topPuts[0]?.strike;
  const strikes =
    call != null && put != null
      ? `${expiry ? `On the ${expiry} chain, the` : "The"} busiest call strike is ${formatNumber(call, 0)} and the busiest put strike is ${formatNumber(put, 0)}.`
      : null;
  let balance: string | null = null;
  if (chain.pcr != null && chain.pcr < 0.85) balance = `The put-call ratio is ${formatNumber(chain.pcr)}. That is put open interest divided by call open interest, so calls carry the larger pile.`;
  else if (chain.pcr != null && chain.pcr > 1.15) balance = `The put-call ratio is ${formatNumber(chain.pcr)}. That is put open interest divided by call open interest, so puts carry the larger pile.`;
  else if (chain.pcr != null) balance = `The put-call ratio is ${formatNumber(chain.pcr)}. That is put open interest divided by call open interest, so the two piles are close.`;
  const meaning = "The busiest strike is simply where the most contracts are still open. Traders watch those levels as crowded positioning. They are not a prediction that NIFTY will stop there.";
  return join([strikes, balance, meaning]);
}

function vixStory(vix: VixPrint | null): string | null {
  if (!vix) return null;
  const move = vix.change === 0 ? "was unchanged at" : vix.change > 0 ? `rose to` : `fell to`;
  const band =
    vix.regime === "low"
      ? "Low on this scale means below 13."
      : vix.regime === "elevated"
        ? "Elevated on this scale means 18 or higher."
        : "Moderate on this scale means from 13 up to 18.";
  return `India VIX ${move} ${formatNumber(vix.close)}. VIX is the price of expected movement in the near-term options, so a higher number means those options became more expensive. On the scale used here, ${formatNumber(vix.close)} is ${vix.regime}. ${band} The bands are our labels, not the exchange’s.`;
}

function understanding(report: Narration): string {
  const parts: string[] = [];
  if (report.nifty && report.nifty.change < 0 && report.cash.today && report.cash.today.fii > 0 && report.cash.today.dii > 0) {
    parts.push("Taken together, institutions were net buyers in cash while the index closed lower, and the points explain that gap: the move lived in the heavyweights, not in the crore totals.");
  } else if (report.nifty && report.nifty.change > 0 && report.cash.today && report.cash.today.fii < 0 && report.cash.today.dii < 0) {
    parts.push("Taken together, institutions were net sellers in cash while the index closed higher. The crore totals and the index can disagree when the buying is in the heavier stocks.");
  }
  parts.push("The understanding is of this session. It is not a prediction of the next one.");
  return parts.join(" ");
}

function spokenNumber(value: number): string {
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  return formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1);
}

function points(value: number): string {
  const abs = Math.abs(value);
  return formatNumber(abs, abs >= 100 ? 0 : 1);
}

function boughtSold(value: number): string {
  if (value > 0) return "bought";
  if (value < 0) return "sold";
  return "were flat at";
}

function crore(value: number): string {
  return `₹${formatNumber(Math.abs(value))} crore`;
}

function contractChange(change: number | null, side: "long" | "short"): string | null {
  if (change == null || change === 0) return null;
  const count = formatNumber(Math.abs(change), 0);
  const verb = change > 0 ? "added" : "cut";
  return `${verb} ${count} ${side} contracts`;
}

function labelSector(name: string): string {
  return SECTOR_LABEL[name] ?? name.replace(/^NIFTY /, "").toLowerCase();
}

function expiryLabel(expiry: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-\d{4}$/.exec(expiry);
  if (!match) return null;
  const month = MONTHS[match[2] ?? ""];
  if (!month) return null;
  return `${Number(match[1])} ${month}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function join(parts: Array<string | null>): string | null {
  const text = parts.filter((part): part is string => Boolean(part)).join(" ");
  return text.length > 0 ? text : null;
}
