"use client";

import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";

function alarm() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < 3; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      const at = ctx.currentTime + i * 0.25;
      osc.frequency.setValueAtTime(880, at);
      gain.gain.setValueAtTime(0.12, at);
      gain.gain.exponentialRampToValueAtTime(0.01, at + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.15);
    }
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Decoration only.
  }
}

const PRESETS = [1, 5, 10, 15];

/** Task/exam countdown, ported from the HTML timerModal. */
export function TrackingTimer({ t }: { t: Dictionary }) {
  const [secondsLeft, setSecondsLeft] = useState(5 * 60);
  const [minutesInput, setMinutesInput] = useState(5);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    },
    [],
  );

  const setPreset = (mins: number) => {
    setRunning(false);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    setMinutesInput(mins);
    setSecondsLeft(mins * 60);
  };

  const toggle = () => {
    if (running) {
      setRunning(false);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      return;
    }
    const start = secondsLeft > 0 ? secondsLeft : Math.max(1, minutesInput) * 60;
    setSecondsLeft(start);
    setRunning(true);
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
          setRunning(false);
          alarm();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const reset = () => {
    setRunning(false);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    setSecondsLeft(Math.max(0, minutesInput) * 60);
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <Panel title={t.trackingTimer}>
      <div className="text-center">
        <p aria-live="polite" className="rounded-2xl bg-black px-4 py-5 font-mono text-4xl tracking-widest text-emerald-400">
          {mm}:{ss}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className="rounded-lg bg-panel-2 px-3 py-1 text-xs hover:border-accent"
            >
              {p}
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={180}
            value={minutesInput}
            onChange={(e) => setMinutesInput(Number(e.target.value) || 0)}
            aria-label={t.trackingTimer}
            className="w-16 rounded-lg border border-border bg-panel-2 px-2 py-1 text-center text-xs outline-none"
          />
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-black"
          >
            {running ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-border px-4 py-2 text-xs"
          >
            ↺
          </button>
        </div>
      </div>
    </Panel>
  );
}
