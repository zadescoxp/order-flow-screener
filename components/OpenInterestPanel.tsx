"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { OI_REGIME_HINT, OI_REGIME_LABEL, oiWindowChange, type OIRegime } from "@/lib/engine/derivatives";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import { STUDY_AXIS_W, STUDY_TIME_H, drawAxisTag, drawEmpty, drawTimeAxis, drawValueAxis } from "@/lib/chartUtils";
import { formatClock, formatCompact, formatPercent, formatPriceValue, formatSigned, priceDecimals } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { OpenInterestPoint } from "@/lib/types/market";

// ─── Open Interest ───────────────────────────────────────────────
// Summed open interest across the selected perpetual venues, sampled
// once a second, with price overlaid. The joint move of price and OI
// over the chosen window classifies who is driving the market.

export const OI_WINDOWS = [
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
  { value: 900, label: "15m" },
] as const;
export type OIWindow = (typeof OI_WINDOWS)[number]["value"];

export function regimeTone(regime: OIRegime | undefined): "buy" | "sell" | "warn" | "muted" {
  if (regime === "new-longs") return "buy";
  if (regime === "new-shorts") return "sell";
  if (regime === "short-covering" || regime === "long-unwind") return "warn";
  return "muted";
}

/** Thin the series so it fits roughly one point per two pixels. */
function downsample(points: OpenInterestPoint[], max: number): OpenInterestPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: OpenInterestPoint[] = [];
  for (let i = points.length - 1; i >= 0; i -= step) out.push(points[i]);
  return out.reverse();
}

export default function OpenInterestPanel() {
  const history = useSessionStore((s) => s.oiHistory);
  const derivatives = useSessionStore((s) => s.derivatives);
  const tickSize = useSessionStore((s) => s.tickSize);
  const symbol = useSessionStore((s) => s.symbol);
  const [windowSec, setWindowSec] = useState<OIWindow>(300);
  const [showPrice, setShowPrice] = useState(true);
  const visibleRef = useRef<{ points: OpenInterestPoint[]; slot: number; plotR: number }>({ points: [], slot: 0, plotR: 0 });

  const change = useMemo(() => oiWindowChange(history, windowSec * 1000), [history, windowSec]);
  const decimals = priceDecimals(tickSize, history[history.length - 1]?.price);
  const base = symbol.replace(/USDT?$|USDC$/, "");

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 8;
      const plotB = H - STUDY_TIME_H;
      if (history.length < 2) {
        drawEmpty(ctx, W, H, derivatives ? "Collecting open interest…" : "Waiting for open interest…", p);
        visibleRef.current = { points: [], slot: 0, plotR };
        return;
      }
      const points = downsample(history, Math.max(20, Math.floor(plotR / 2)));
      const slot = plotR / Math.max(points.length - 1, 1);
      const xOf = (i: number) => i * slot;
      const ois = points.map((pt) => pt.openInterest);
      let min = Math.min(...ois);
      let max = Math.max(...ois);
      const pad = (max - min) * 0.12 || max * 0.0005 || 1;
      min -= pad;
      max += pad;
      const yOf = (v: number) => plotT + ((max - v) / (max - min)) * (plotB - plotT);
      drawValueAxis(ctx, min, max, yOf, plotR, plotT, plotB, W, p, (v) => formatCompact(v, 2));

      // Shade the regime window.
      if (change) {
        const startIdx = points.findIndex((pt) => pt.time >= change.from.time);
        if (startIdx >= 0) {
          ctx.fillStyle = withAlpha(p.accent, 0.06);
          ctx.fillRect(xOf(startIdx), plotT, plotR - xOf(startIdx), plotB - plotT);
        }
      }

      ctx.beginPath();
      ctx.moveTo(xOf(0), plotB);
      ois.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(ois.length - 1), plotB);
      ctx.closePath();
      ctx.fillStyle = withAlpha(p.accent, 0.12);
      ctx.fill();
      ctx.beginPath();
      ois.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (showPrice) {
        const closes = points.map((pt) => pt.price);
        const pMin = Math.min(...closes);
        const pMax = Math.max(...closes);
        const pPad = (pMax - pMin) * 0.1 || pMax * 0.0005 || 1;
        const pyOf = (v: number) => plotT + ((pMax + pPad - v) / (pMax - pMin + 2 * pPad)) * (plotB - plotT);
        ctx.beginPath();
        closes.forEach((v, i) => (i ? ctx.lineTo(xOf(i), pyOf(v)) : ctx.moveTo(xOf(i), pyOf(v))));
        ctx.strokeStyle = withAlpha(p.text, 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = monoFont(9, 600);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.textMuted;
        ctx.fillText(`PRICE ${formatPriceValue(pMax, decimals)}`, 6, plotT + 6);
        ctx.fillText(`${formatPriceValue(pMin, decimals)}`, 6, plotB - 8);
      }

      const last = ois[ois.length - 1];
      drawAxisTag(ctx, yOf(last), plotR, W, formatCompact(last, 2), p.accent, p);
      drawTimeAxis(ctx, points.map((pt) => pt.time), xOf, plotB, W, p, true);
      visibleRef.current = { points, slot, plotR };
    },
    [history, derivatives, change, showPrice, decimals]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { points, slot, plotR } = visibleRef.current;
    if (!points.length || x > plotR) return hideTooltip();
    const pt = points[Math.round(x / slot)];
    if (!pt) return hideTooltip();
    showTooltip(
      `Open interest ${formatCompact(pt.openInterest, 3)} ${base}`,
      [
        `Time: ${formatClock(pt.time)}`,
        `Notional: $${formatCompact(pt.openInterest * pt.price, 2)}`,
        `Price: ${formatPriceValue(pt.price, decimals)}`,
        "",
        "What this means: Open interest is the number of open contracts. Rising OI means new positions are opening; falling OI means positions are closing.",
      ].join("\n"),
      e
    );
  };

  const regime = change?.regime;
  const reporting = derivatives?.venues.filter((v) => v.openInterest !== undefined).length ?? 0;

  return (
    <Panel
      title="Open Interest" icon={<Icon.Layers />}
      subtitle={reporting > 1 ? `summed over ${reporting} venues` : "open contracts"}
      value={
        derivatives?.openInterestValue ? (
          <span className="tone-accent">${formatCompact(derivatives.openInterestValue, 2)}</span>
        ) : (
          "—"
        )
      }
      actions={
        <>
          <button type="button" className={`ui-button chip ${showPrice ? "is-active" : ""}`} onClick={() => setShowPrice((v) => !v)}>
            Price
          </button>
          <Segmented size="xs" value={windowSec} onChange={setWindowSec} options={OI_WINDOWS} ariaLabel="Regime window" />
        </>
      }
      footer={
        <div className="study-stats">
          <Stat
            label={`OI Δ ${OI_WINDOWS.find((w) => w.value === windowSec)?.label}`}
            value={change ? formatPercent(change.oiChange * 100, 2) : "—"}
            sub={change ? `${formatSigned(change.oiDelta, 2)} ${base}` : undefined}
            tone={change ? (change.oiChange >= 0 ? "buy" : "sell") : "muted"}
          />
          <Stat
            label="Price Δ"
            value={change ? formatPercent(change.priceChange * 100, 2) : "—"}
            tone={change ? (change.priceChange >= 0 ? "buy" : "sell") : "muted"}
          />
          <Stat
            label="Regime"
            value={regime ? OI_REGIME_LABEL[regime] : "—"}
            tone={regimeTone(regime)}
            title={regime ? OI_REGIME_HINT[regime] : "Needs a full window of open-interest history"}
          />
        </div>
      }
    >
      <div ref={containerRef} className="canvas-host" onMouseMove={handleMove} onMouseLeave={hideTooltip}>
        <canvas ref={canvasRef} />
      </div>
    </Panel>
  );
}
