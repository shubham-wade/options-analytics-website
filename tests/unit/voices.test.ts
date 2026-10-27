import { describe, expect, it } from "vitest";
import { rankVoices } from "@/lib/report/voices";

describe("reader voices", () => {
  it("puts a natural Indian voice ahead of the desktop Microsoft voices", () => {
    const ranked = rankVoices([
      { voiceURI: "david", name: "Microsoft David Desktop", lang: "en-US" },
      { voiceURI: "heera", name: "Microsoft Heera Desktop", lang: "en-IN" },
      { voiceURI: "google", name: "Google UK English Female", lang: "en-GB" },
      { voiceURI: "neerja", name: "Microsoft Neerja Online (Natural)", lang: "en-IN" },
      { voiceURI: "hindi", name: "Microsoft Kalpana", lang: "hi-IN" },
    ]);
    expect(ranked.map((voice) => voice.id)).toEqual(["neerja", "google", "heera", "david"]);
    expect(ranked[0]?.human).toBe(true);
    expect(ranked[2]?.human).toBe(false);
  });
});