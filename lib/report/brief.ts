import type { IndexContributor } from "@/lib/report/types";

export interface MarketBrief {
  asOf: string;
  pullers: IndexContributor[];
  draggers: IndexContributor[];
  books: { name: string; longChange: number | null; shortChange: number | null }[];
  futuresReading: string | null;
  oi: { expiry: string; callStrike: number; putStrike: number } | null;
}

const BOOK_NAMES = ["Client", "Pro", "FII"];

/** Slim the saved report down to the dashboard strip. */
export function marketBriefFrom(report: {
  asOf: string;
  contributors?: { pullers?: IndexContributor[]; draggers?: IndexContributor[] } | null;
  participants?: { name: string; futureIndexLongChange: number | null; futureIndexShortChange: number | null }[] | null;
  futures?: { reading?: string | null } | null;
  chains?: { expiry: string; topCalls?: { strike: number }[]; topPuts?: { strike: number }[] }[] | null;
}): MarketBrief {
  const call = report.chains?.[0]?.topCalls?.[0];
  const put = report.chains?.[0]?.topPuts?.[0];
  return {
    asOf: report.asOf,
    pullers: (report.contributors?.pullers ?? []).slice(0, 3),
    draggers: (report.contributors?.draggers ?? []).slice(0, 3),
    books: BOOK_NAMES.map((name) => {
      const row = report.participants?.find((participant) => participant.name === name);
      return {
        name,
        longChange: row?.futureIndexLongChange ?? null,
        shortChange: row?.futureIndexShortChange ?? null,
      };
    }),
    futuresReading: report.futures?.reading ?? null,
    oi: call && put ? { expiry: report.chains![0]!.expiry, callStrike: call.strike, putStrike: put.strike } : null,
  };
}
