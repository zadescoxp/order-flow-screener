"use client";

import React, { useCallback, useMemo, useRef } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import { formatClock, formatCompact } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { OBISnapshot } from "@/lib/types/market";

// ─── Order Book Imbalance ────────────────────────────────────────
// OBI = (bid − ask) / (bid + ask) within a common depth band.
// Shows the live gauge, a smoothed reading and a short history.

const EMA_ALPHA = 0.15;

function obiTone(value: number): "buy" | "sell" | "muted" {
  if (value > 0.2) return "buy";
  if (value < -0.2) return "sell";
  return "muted";
}

export default function OBIPanel() {
  const history = useSessionStore((s) => s.obiHistory);
  const current = useSessionStore((s) => s.currentOBI);
  const marketType = useSessionStore((s) => s.marketType);
  const hoverRef = useRef<{ points: OBISnapshot[]; slot: number }>({ points: [], slot: 0 });

  const smoothed = useMemo(() => {
    const out: number[] = [];
    for (const snap of history) {
      const prev = out[out.length - 1];
      out.push(prev === undefined ? snap.value : prev + EMA_ALPHA * (snap.value - prev));
    }
    return out;
  }, [history]);
  const smooth = smoothed[smoothed.length - 1] ?? 0;
  const last = history[history.length - 1];

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const points = history.slice(-Math.max(10, Math.floor(W / 2)));
      const ema = smoothed.slice(-points.length);
      const slot = W / Math.max(points.length - 1, 1);
      const pad = 6;
      const yOf = (v: number) => pad + ((1 - v) / 2) * (H - pad * 2);
      const y0 = yOf(0);

      for (const level of [0.5, -0.5]) {
        ctx.strokeStyle = p.grid;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yOf(level)) + 0.5);
        ctx.lineTo(W, Math.round(yOf(level)) + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = p.border;
      ctx.fillRect(0, Math.round(y0), W, 1);
      ctx.font = monoFont(8, 600);
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("BID", 4, yOf(0.8));
      ctx.fillText("ASK", 4, yOf(-0.8));

      if (points.length < 2) return;
      points.forEach((snap, i) => {
        const y = yOf(snap.value);
        ctx.fillStyle = withAlpha(snap.value >= 0 ? p.buy : p.sell, 0.45);
        ctx.fillRect(i * slot - Math.max(1, slot) / 2, Math.min(y, y0), Math.max(1, slot), Math.abs(y - y0));
      });
      ctx.beginPath();
      ema.forEach((v, i) => (i ? ctx.lineTo(i * slot, yOf(v)) : ctx.moveTo(0, yOf(v))));
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 1.25;
      ctx.stroke();
      hoverRef.current = { points, slot };
    },
    [history, smoothed]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const tone = obiTone(current);
  const bidShare = (current + 1) / 2;

  return (
    <Panel
      title="Book Imbalance" icon={<Icon.Gauge />}
      subtitle={marketType === "forex" ? "quote-flow proxy" : "OBI · common depth band"}
      value={<span className={`tone-${tone}`}>{current >= 0 ? "+" : ""}{current.toFixed(2)}</span>}
      className="obi-panel"
    >
      <div className="obi-gauge" aria-label={`OBI ${current.toFixed(2)}`}>
        <div className="obi-track">
          <span className="obi-mid" />
          <span className={`obi-marker tone-bg-${tone}`} style={{ left: `${bidShare * 100}%` }} />
          <span className="obi-ema" style={{ left: `${((smooth + 1) / 2) * 100}%` }} title="Smoothed (EMA)" />
        </div>
        <div className="obi-legend">
          <span className="tone-sell">Ask heavy</span>
          <span>EMA {smooth >= 0 ? "+" : ""}{smooth.toFixed(2)}</span>
          {last && <span>{formatCompact(last.bidVolume)} / {formatCompact(last.askVolume)}</span>}
          <span className="tone-buy">Bid heavy</span>
        </div>
      </div>
      <div
        ref={containerRef}
        className="canvas-host obi-history"
        onMouseMove={(e) => {
          const rect = containerRef.current!.getBoundingClientRect();
          const { points, slot } = hoverRef.current;
          const snap = points[Math.round((e.clientX - rect.left) / (slot || 1))];
          if (!snap) return hideTooltip();
          showTooltip(
            `OBI ${snap.value >= 0 ? "+" : ""}${snap.value.toFixed(3)}`,
            [
              `Time: ${formatClock(snap.timestamp)}`,
              `Bid depth: ${formatCompact(snap.bidVolume, 2)}`,
              `Ask depth: ${formatCompact(snap.askVolume, 2)}`,
              "",
              "What this means: +1 means all resting size in the band is on the bid, −1 means all on the ask. The white line is a smoothed reading.",
            ].join("\n"),
            e
          );
        }}
        onMouseLeave={hideTooltip}
      >
        <canvas ref={canvasRef} />
      </div>
    </Panel>
  );
}
