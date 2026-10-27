import { describe, expect, it } from "vitest";
import { speakable, speechSentences } from "@/lib/report/speak";

describe("report reader text", () => {
  it("splits the reading into sentences and says tickers as names", () => {
    const sentences = speechSentences([
      "NIFTY finished at 22,811.35, down 77.6 points, or 0.34%. INFY, TCS and BHARTIARTL added the most points.",
    ]);
    expect(sentences).toHaveLength(2);
    expect(speakable(sentences[0] ?? "")).toBe("NIFTY finished at 22,811.35, down 77.6 points, or 0.34 percent.");
    expect(speakable(sentences[1] ?? "")).toBe("Infosys, T.C.S. and Bharti Airtel added the most points.");
  });

  it("says rupees instead of the currency sign", () => {
    expect(speakable("Foreign institutions bought ₹1,022.32 crore.")).toBe("Foreign institutions bought rupees 1,022.32 crore.");
  });
});
