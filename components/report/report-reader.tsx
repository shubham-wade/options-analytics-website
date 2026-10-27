"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { speakable, speechSentences } from "@/lib/report/speak";
import { rankVoices, type ListedVoice } from "@/lib/report/voices";

const VOICE_KEY = "nrl-reader-voice";

type Playback = "idle" | "playing" | "paused";

export function ReportReader({ paragraphs, sessionKey }: { paragraphs: string[]; sessionKey: string }) {
  const sentences = useMemo(() => speechSentences(paragraphs), [paragraphs]);
  const [playback, setPlayback] = useState<Playback>("idle");
  const [unsupported, setUnsupported] = useState(false);
  const [voices, setVoices] = useState<ListedVoice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const stopFlag = useRef(false);
  const generation = useRef(0);
  const voiceIdRef = useRef("");
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;

  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return;
    const saved = window.localStorage.getItem(VOICE_KEY) ?? "";
    const load = () => {
      const ranked = rankVoices(synthesis.getVoices());
      setVoices(ranked);
      const chosen = ranked.some((voice) => voice.id === saved) ? saved : ranked.find((voice) => voice.human)?.id ?? ranked[0]?.id ?? "";
      setVoiceId((current) => {
        const next = current && ranked.some((voice) => voice.id === current) ? current : chosen;
        voiceIdRef.current = next;
        return next;
      });
    };
    load();
    synthesis.addEventListener("voiceschanged", load);
    return () => synthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => {
    setUnsupported(typeof window !== "undefined" && !window.speechSynthesis);
  }, []);

  useEffect(() => {
    stopFlag.current = true;
    generation.current += 1;
    window.speechSynthesis?.cancel();
    setPlayback("idle");
    return () => {
      stopFlag.current = true;
      generation.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, [sessionKey]);

  function speakAt(start: number) {
    const synthesis = window.speechSynthesis;
    const line = sentencesRef.current[start];
    if (stopFlag.current || !synthesis || !line) {
      setPlayback("idle");
      return;
    }
    const token = generation.current;
    const utterance = new SpeechSynthesisUtterance(speakable(line));
    utterance.rate = 0.95;
    const voice = synthesis.getVoices().find((item) => item.voiceURI === voiceIdRef.current);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      if (stopFlag.current || token !== generation.current) return;
      const next = start + 1;
      if (next < sentencesRef.current.length) speakAt(next);
      else setPlayback("idle");
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      if (token !== generation.current) return;
      setPlayback("idle");
    };
    setPlayback("playing");
    window.setTimeout(() => {
      if (stopFlag.current || token !== generation.current) return;
      synthesis.speak(utterance);
    }, 40);
  }

  function listen() {
    const synthesis = window.speechSynthesis;
    if (!synthesis) {
      setUnsupported(true);
      return;
    }
    if (playback === "playing") {
      synthesis.pause();
      setPlayback("paused");
      return;
    }
    if (playback === "paused") {
      synthesis.resume();
      setPlayback("playing");
      return;
    }
    stopFlag.current = false;
    generation.current += 1;
    const begin = () => speakAt(0);
    if (synthesis.getVoices().length > 0) {
      synthesis.cancel();
      begin();
      return;
    }
    let started = false;
    const onVoices = () => {
      if (started) return;
      started = true;
      window.clearTimeout(timer);
      synthesis.removeEventListener("voiceschanged", onVoices);
      if (stopFlag.current) return;
      synthesis.cancel();
      begin();
    };
    synthesis.addEventListener("voiceschanged", onVoices);
    const timer = window.setTimeout(onVoices, 400);
    synthesis.getVoices();
  }

  function stop() {
    stopFlag.current = true;
    generation.current += 1;
    window.speechSynthesis?.cancel();
    setPlayback("idle");
  }

  function chooseVoice(id: string) {
    setVoiceId(id);
    voiceIdRef.current = id;
    window.localStorage.setItem(VOICE_KEY, id);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={listen} disabled={unsupported || sentences.length === 0}>
        {playback === "playing" ? "Pause" : playback === "paused" ? "Resume" : "Play"}
      </Button>
      {playback !== "idle" ? (
        <Button type="button" size="sm" variant="ghost" onClick={stop}>
          Stop
        </Button>
      ) : null}
      <select
        aria-label="Reading voice"
        className="h-8 max-w-[22rem] rounded-md border border-input bg-background px-2 text-xs text-foreground"
        value={voiceId}
        disabled={unsupported || voices.length === 0}
        onChange={(event) => chooseVoice(event.target.value)}
      >
        {voices.length === 0 ? <option value="">Loading voices</option> : null}
        {voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
            {voice.human ? " · more natural" : ""}
          </option>
        ))}
      </select>
      {unsupported ? <span className="text-xs text-muted-foreground">This browser cannot play audio.</span> : null}
    </div>
  );
}

