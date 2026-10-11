"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import type { FromWhisper, ToWhisper } from "./whisper.worker";

// Whisper wants 16kHz mono.
const RATE = 16000;
// Recording stops by itself once you've said something and paused this long, if you say nothing
// for NOTHING_MS, or after MAX_MS.
const PAUSE_MS = 2000;
const NOTHING_MS = 8000;
const MAX_MS = 120_000;
// How loud counts as talking: the mic signal's RMS, from 0 to 1. If it never gets there, we don't ask
// Whisper, which makes something up for silence (often "you").
const TALKING = 0.01;

// One Whisper for the page, started on the first click, so nobody who never talks downloads it.
let whisper: Worker | null = null;
const listeners = new Set<(m: FromWhisper) => void>();
const tell = (m: ToWhisper) => {
  if (!whisper) {
    whisper = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    whisper.onmessage = ({ data }: MessageEvent<FromWhisper>) => listeners.forEach((hear) => hear(data));
  }
  whisper.postMessage(m);
};

const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
const unchanging = () => () => {};

type Take = { id: number; lead: string; stop: () => void; cancel: () => void };
let takes = 0;

/**
 * Talk instead of typing. It records until you pause, then Whisper writes it down in the browser
 * (nothing you say leaves your device) and onText gets what you had typed plus what you said.
 * The first time, it downloads the model while you talk.
 */
export function useDictation(onText: (text: string) => void) {
  const supported = useSyncExternalStore(unchanging, canRecord, () => false);
  const [phase, setPhase] = useState<"idle" | "listening" | "writing">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [download, setDownload] = useState<number | null>(null); // % of the model, while it downloads
  const take = useRef<Take | null>(null);

  const finish = (problem: string | null = null) => {
    take.current = null;
    setPhase("idle");
    setProblem(problem);
  };

  const hear = useEffectEvent((m: FromWhisper) => {
    if (m.kind === "loading") return setDownload(m.progress);
    if (m.kind === "ready") return setDownload(null);
    const t = take.current;
    // A failed download with nothing to write down yet: the transcribe request will retry it.
    if (!t || m.id !== t.id) return;
    if (m.kind === "error") return finish("Couldn’t load Whisper. Check your connection and try again.");
    if (m.text) onText(t.lead + m.text);
    finish(m.text ? null : "Didn’t catch that. Try again.");
  });

  useEffect(() => {
    const listener = (m: FromWhisper) => hear(m);
    listeners.add(listener);
    const live = take;
    return () => {
      listeners.delete(listener);
      live.current?.cancel();
    };
  }, []);

  const start = async (typed: string) => {
    if (take.current) return;
    let cancelled = false;
    const t: Take = {
      id: ++takes,
      lead: typed.trim() ? `${typed.trimEnd()} ` : "",
      stop: () => {},
      cancel: () => (cancelled = true),
    };
    take.current = t;
    setProblem(null);
    setPhase("listening");
    tell({ kind: "load" }); // download while you talk
    // Made during the click, so the browser lets it run.
    const meter = new AudioContext();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      void meter.close();
      if (!cancelled) finish(micProblem(e));
      return;
    }
    if (cancelled) {
      void meter.close();
      return stream.getTracks().forEach((track) => track.stop());
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const watch = whenDone(meter, stream, () => t.stop());
    recorder.onstop = async () => {
      watch.stop();
      stream.getTracks().forEach((track) => track.stop());
      if (cancelled) return;
      if (!watch.heard()) return finish("Didn’t catch that. Try again.");
      setPhase("writing");
      try {
        const audio = await decode(new Blob(chunks, { type: recorder.mimeType }));
        if (!cancelled) tell({ kind: "transcribe", id: t.id, audio });
      } catch {
        finish("Couldn’t hear that. Try again.");
      }
    };
    t.stop = () => recorder.state === "recording" && recorder.stop();
    t.cancel = () => {
      cancelled = true;
      t.stop();
    };
    recorder.start();
  };

  return {
    supported,
    listening: phase === "listening",
    writing: phase === "writing",
    // What to show beside the mic. live: Fred is working on it, so it shimmers.
    status:
      phase === "listening"
        ? { text: "Listening…", live: true }
        : phase === "writing"
          ? { text: download === null ? "Writing it down…" : `Downloading Whisper, first time only… ${Math.round(download)}%`, live: true }
          : problem
            ? { text: problem, live: false }
            : null,
    start,
    /** Stop recording and write down what was said. */
    stop: () => take.current?.stop(),
    /** Stop and drop it, e.g. when the message is sent. */
    cancel: () => {
      take.current?.cancel();
      finish();
    },
  };
}

// Calls done once you've talked and then paused, if you never start, or at the time limit.
// heard() says whether you said anything at all.
function whenDone(meter: AudioContext, stream: MediaStream, done: () => void) {
  const analyser = meter.createAnalyser();
  meter.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const began = Date.now();
  let talked = 0;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const loudness = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    const now = Date.now();
    if (loudness > TALKING) talked = now;
    if ((talked ? now - talked > PAUSE_MS : now - began > NOTHING_MS) || now - began > MAX_MS) done();
  }, 100);
  return {
    heard: () => talked > 0,
    stop: () => {
      clearInterval(timer);
      void meter.close();
    },
  };
}

// The recording (webm or mp4, depending on the browser) as 16kHz mono samples.
async function decode(recording: Blob) {
  const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await recording.arrayBuffer());
  return audio.getChannelData(0);
}

function micProblem(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Allow the microphone to talk to Fred.";
  if (name === "NotFoundError") return "No microphone found.";
  return "Couldn’t start the microphone.";
}
