export interface ListedVoice {
  id: string;
  name: string;
  lang: string;
  /** Natural, neural, or Google voices sound less like a desktop screen reader. */
  human: boolean;
}

export function rankVoices(voices: { voiceURI: string; name: string; lang: string }[]): ListedVoice[] {
  return voices
    .filter((voice) => voice.lang.toLowerCase().startsWith("en") && voice.voiceURI)
    .map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      human: /natural|neural|premium|enhanced|google/i.test(voice.name),
    }))
    .sort((left, right) => voiceScore(right) - voiceScore(left) || left.name.localeCompare(right.name));
}

function voiceScore(voice: ListedVoice): number {
  let score = 0;
  if (/natural|neural/i.test(voice.name)) score += 100;
  if (/premium|enhanced/i.test(voice.name)) score += 80;
  if (/google/i.test(voice.name)) score += 50;
  if (/online/i.test(voice.name)) score += 20;
  const lang = voice.lang.toLowerCase();
  if (lang === "en-in") score += 15;
  else if (lang.startsWith("en-gb")) score += 8;
  else if (lang.startsWith("en-us")) score += 5;
  if (/microsoft (david|zira|mark|heera|ravi)/i.test(voice.name) && !/natural|online/i.test(voice.name)) score -= 30;
  return score;
}
