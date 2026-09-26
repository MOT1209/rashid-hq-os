"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";

const COLORS = ["#c9a227", "#17924a", "#7c5cff", "#e05299", "#2f9fd0", "#e07b39", "#14b8a6", "#d13b3b"];

function beep(win: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = win ? [261.63, 329.63, 392.0, 523.25] : [400];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const at = ctx.currentTime + i * 0.09;
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.15, at);
      gain.gain.exponentialRampToValueAtTime(0.01, at + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    });
    window.setTimeout(() => void ctx.close(), notes.length * 100 + 400);
  } catch {
    // Audio is decoration — a missing AudioContext must never break the spin.
  }
}

/**
 * Fair random picker over the member list, drawn on canvas exactly like the
 * HTML wheelModal (pointer at top, ease-out spin, tick sound per frame).
 */
export function TrackingWheel({ t, names }: { t: Dictionary; names: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const [winner, setWinner] = useState("");
  const [spinning, setSpinning] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const n = names.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (n === 0) {
      ctx.fillStyle = "#8b98a9";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t.trackingNoMembers, canvas.width / 2, canvas.height / 2);
      return;
    }
    const arc = (Math.PI * 2) / n;
    for (let i = 0; i < n; i += 1) {
      const angle = angleRef.current + i * arc;
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.beginPath();
      ctx.arc(150, 150, 140, angle, angle + arc);
      ctx.arc(150, 150, 32, angle + arc, angle, true);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.translate(150 + Math.cos(angle + arc / 2) * 96, 150 + Math.sin(angle + arc / 2) * 96);
      ctx.rotate(angle + arc / 2 + Math.PI / 2);
      const label = names[i].length > 12 ? `${names[i].slice(0, 10)}…` : names[i];
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(label, -ctx.measureText(label).width / 2, 0);
      ctx.restore();
    }
  }, [names, t]);

  useEffect(() => {
    draw();
  }, [draw]);

  const spin = () => {
    if (names.length === 0 || spinning) return;
    setSpinning(true);
    setWinner("");
    const total = Math.random() * 3000 + 4000;
    const start = Math.random() * 10 + 10;
    const t0 = performance.now();
    const frame = (now: number) => {
      const elapsed = now - t0;
      if (elapsed >= total) {
        const degrees = ((angleRef.current * 180) / Math.PI + 90) % 360;
        const idx = Math.floor((360 - degrees) / (360 / names.length)) % names.length;
        setWinner(names[idx]);
        setSpinning(false);
        beep(true);
        return;
      }
      // Cubic ease-out: fast start, gentle landing.
      const p = elapsed / total;
      const step = start * (1 - (1 - p) * (1 - p) * (1 - p));
      angleRef.current += (step * Math.PI) / 180 / 60;
      draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  return (
    <Panel title={t.trackingWheel}>
      <div className="text-center">
        <div className="relative mx-auto w-fit">
          <div aria-hidden className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 text-xl text-err">▼</div>
          <canvas ref={canvasRef} width={300} height={300} className="max-w-full rounded-full border-4 border-accent/60" />
        </div>
        <p aria-live="polite" className="mt-3 min-h-6 text-sm font-bold text-accent">
          {winner || (spinning ? "…" : "")}
        </p>
        <button
          type="button"
          onClick={spin}
          disabled={spinning || names.length === 0}
          className="mt-2 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {t.trackingWheel}
        </button>
      </div>
    </Panel>
  );
}
