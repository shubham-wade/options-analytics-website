export interface ResearchRow {
  symbol: string;
  name: string;
  last: number | null;
  fromLow: number | null;
  fromHigh: number | null;
  sinceSaved: number | null;
  lines: string[];
}

export interface OpenRow {
  id: string;
  symbol: string;
  name: string | null;
  quantity: number;
  entry: number;
  openedOn: string;
  last: number | null;
  markSource: "live" | "file" | null;
  sinceEntry: number | null;
  unrealised: number | null;
  lines: string[];
}

export interface ClosedRow {
  id: string;
  symbol: string;
  quantity: number;
  entry: number;
  exit: number | null;
  openedOn: string;
  closedOn: string;
  realised: number;
  sinceEntry: number | null;
}

export interface PaperDesk {
  summary: { cost: number; marketValue: number | null; unrealised: number | null; realised: number };
  research: ResearchRow[];
  open: OpenRow[];
  closed: ClosedRow[];
}
