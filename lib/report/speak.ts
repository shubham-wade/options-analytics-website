const NAMES: Record<string, string> = {
  AXISBANK: "Axis Bank",
  BAJAJFINSV: "Bajaj Finserv",
  "BAJAJ-AUTO": "Bajaj Auto",
  BAJFINANCE: "Bajaj Finance",
  BHARTIARTL: "Bharti Airtel",
  BPCL: "B.P.C.L.",
  BRITANNIA: "Britannia",
  CIPLA: "Cipla",
  COALINDIA: "Coal India",
  DIVISLAB: "Divis Labs",
  DRREDDY: "Doctor Reddy",
  EICHERMOT: "Eicher Motors",
  ETERNAL: "Eternal",
  FMCG: "F.M.C.G.",
  GRASIM: "Grasim",
  HCLTECH: "H.C.L. Tech",
  HDFCBANK: "H.D.F.C. Bank",
  HDFCLIFE: "H.D.F.C. Life",
  HEROMOTOCO: "Hero MotoCorp",
  HINDALCO: "Hindalco",
  HINDUNILVR: "Hindustan Unilever",
  ICICIBANK: "I.C.I.C.I. Bank",
  INDUSINDBK: "IndusInd Bank",
  INFY: "Infosys",
  IT: "I.T.",
  ITC: "I.T.C.",
  JIOFIN: "Jio Financial",
  JSWSTEEL: "J.S.W. Steel",
  KOTAKBANK: "Kotak Bank",
  LT: "Larsen and Toubro",
  "M&M": "Mahindra",
  MARUTI: "Maruti",
  MAXHEALTH: "Max Healthcare",
  NESTLEIND: "Nestle",
  NTPC: "N.T.P.C.",
  ONGC: "O.N.G.C.",
  POWERGRID: "Power Grid",
  PSU: "P.S.U.",
  RELIANCE: "Reliance",
  SBILIFE: "S.B.I. Life",
  SBIN: "State Bank",
  SHRIRAMFIN: "Shriram Finance",
  SUNPHARMA: "Sun Pharma",
  TATACONSUM: "Tata Consumer",
  TATAMOTORS: "Tata Motors",
  TATASTEEL: "Tata Steel",
  TCS: "T.C.S.",
  TECHM: "Tech Mahindra",
  TITAN: "Titan",
  TRENT: "Trent",
  ULTRACEMCO: "UltraTech Cement",
  VIX: "vix",
  WIPRO: "Wipro",
};

/** Sentences in the order a reader should speak them. */
export function speechSentences(paragraphs: string[]): string[] {
  return paragraphs.flatMap((paragraph) =>
    paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean),
  );
}

/** The same sentence, with symbols and currency written the way a voice should say them. */
export function speakable(sentence: string): string {
  const named = sentence.replace(/\b[A-Z][A-Z0-9&.-]{1,}\b/g, (token) => NAMES[token] ?? token);
  return named.replaceAll("₹", "rupees ").replaceAll("%", " percent").replace(/\s{2,}/g, " ").trim();
}
