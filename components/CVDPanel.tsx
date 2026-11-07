"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { resampleBars } from "@/lib/engine/analytics";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import {
  RESOLUTIONS,
  STUDY_AXIS_W,
  STUDY_TIME_H,
  drawAxisTag,
  drawCrosshairX,
  drawEmpty,
  drawTimeAxis,
  drawValueAxis,
} from "@/lib/chartUtils";
import { formatClock, formatCompact, formatPriceValue, formatSigned, priceDecimals } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { FlowBar } from "@/lib/types/market";

// ─── Cumulative Volume Delta ─────────────────────────────────────
// Running sum of (aggressive buy − aggressive sell) volume since the
// feed connected, plotted against price so divergences stand out.

type Resolution = (typeof RESOLUTIONS)[number]["value"];

export default function CVDPanel() {
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const tickSize = useSessionStore((s) => s.tickSize);
  const crosshairTime = useSessionStore((s) => s.crosshairTime);
  const [resolution, setResolution] = useState<Resolution>(5);
  const [showPrice, setShowPrice] = useState(true);
  const visibleRef = useRef<{ points: FlowBar[]; slot: number; plotR: number }>({ points: [], slot: 0, plotR: 0 });

  const bars = useMemo(
    () => resampleBars(liveBar ? [...flowBars, liveBar] : flowBars, resolution),
    [flowBars, liveBar, resolution]
  );
  const decimals = priceDecimals(tickSize, bars[bars.length - 1]?.close);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 8;
      const plotB = H - STUDY_TIME_H;
      if (bars.length < 2) {
        drawEmpty(ctx, W, H, "Waiting for executed flow…", p);
        visibleRef.current = { points: [], slot: 0, plotR };
        return;
      }
      const points = bars.slice(-Math.max(10, Math.floor(plotR / 2)));
      const slot = plotR / Math.max(points.length - 1, 1);
      const xOf = (i: number) => i * slot;
      const cvds = points.map((b) => b.cvd);
      let min = Math.min(0, ...cvds);
      let max = Math.max(0, ...cvds);
      const pad = (max - min) * 0.1 || 1;
      min -= pad;
      max += pad;
      const yOf = (v: number) => plotT + ((max - v) / (max - min)) * (plotB - plotT);
      drawValueAxis(ctx, min, max, yOf, plotR, plotT, plotB, W, p, (v) => formatCompact(v));

      const y0 = yOf(0);
      ctx.fillStyle = p.border;
      ctx.fillRect(0, Math.round(y0), plotR, 1);

      // Area split above / below zero
      for (const [sign, color] of [[1, p.buy], [-1, p.sell]] as const) {
        ctx.save();
        ctx.beginPath();
        if (sign > 0) ctx.rect(0, plotT, plotR, y0 - plotT);
        else ctx.rect(0, y0, plotR, plotB - y0);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(xOf(0), y0);
        cvds.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
        ctx.lineTo(xOf(cvds.length - 1), y0);
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, 0.16);
        ctx.fill();
        ctx.beginPath();
        cvds.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Price overlay on its own scale
      if (showPrice) {
        const closes = points.map((b) => b.close);
        const pMin = Math.min(...closes);
        const pMax = Math.max(...closes);
        const pPad = (pMax - pMin) * 0.1 || pMax * 0.0005 || 1;
        const pyOf = (v: number) => plotT + ((pMax + pPad - v) / (pMax - pMin + 2 * pPad)) * (plotB - plotT);
        ctx.beginPath();
        closes.forEach((v, i) => (i ? ctx.lineTo(xOf(i), pyOf(v)) : ctx.moveTo(xOf(i), pyOf(v))));
        ctx.strokeStyle = withAlpha(p.text, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = monoFont(9, 600);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = p.textMuted;
        ctx.fillText(`PRICE ${formatPriceValue(pMax, decimals)}`, 6, plotT + 6);
        ctx.fillText(`${formatPriceValue(pMin, decimals)}`, 6, plotB - 8);
      }

      const last = cvds[cvds.length - 1];
      drawAxisTag(ctx, yOf(last), plotR, W, formatCompact(last), last >= 0 ? p.buy : p.sell, p);
      drawTimeAxis(ctx, points.map((b) => b.time), xOf, plotB, W, p, resolution < 60);
      if (crosshairTime !== null) {
        const idx = (crosshairTime - points[0].time) / (resolution * 1000);
        if (idx >= 0 && idx <= points.length - 1) drawCrosshairX(ctx, xOf(idx), plotT, plotB, p);
      }
      visibleRef.current = { points, slot, plotR };
    },
    [bars, showPrice, crosshairTime, resolution, decimals]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { points, slot, plotR } = visibleRef.current;
    if (!points.length || x > plotR) return hideTooltip();
    const bar = points[Math.round(x / slot)];
    if (!bar) return hideTooltip();
    showTooltip(
      `CVD ${formatSigned(bar.cvd, 2)}`,
      [
        `Time: ${formatClock(bar.time)}`,
        `Price: ${formatPriceValue(bar.close, decimals)}`,
        `Bar delta: ${formatSigned(bar.buyVolume - bar.sellVolume, 3)}`,
        `Bar volume: ${formatCompact(bar.volume, 3)}`,
        "",
        "What this means: Rising CVD with falling price (or the reverse) is a divergence: aggressive flow is not moving price, which often signals absorption.",
      ].join("\n"),
      e
    );
  };

  // Slope over the last minute of flow
  const minuteAgo = bars.length ? bars[Math.max(0, bars.length - 1 - Math.round(60 / resolution))] : undefined;
  const last = bars[bars.length - 1];
  const slope = last && minuteAgo ? last.cvd - minuteAgo.cvd : 0;
  const priceMove = last && minuteAgo ? last.close - minuteAgo.close : 0;
  const divergence = Math.sign(slope) !== 0 && Math.sign(priceMove) !== 0 && Math.sign(slope) !== Math.sign(priceMove);

  return (
    <Panel
      title="Cumulative Delta" icon={<Icon.Delta />}
      subtitle="aggressive buy − sell, session"
      value={<span className={last && last.cvd >= 0 ? "tone-buy" : "tone-sell"}>{last ? formatSigned(last.cvd) : "—"}</span>}
      actions={
        <>
          <button type="button" className={`ui-button chip ${showPrice ? "is-active" : ""}`} onClick={() => setShowPrice((v) => !v)}>
            Price
          </button>
          <Segmented size="xs" value={resolution} onChange={setResolution} options={RESOLUTIONS} ariaLabel="Bar size" />
        </>
      }
      footer={
        <div className="study-stats">
          <Stat label="Δ 1 min" value={formatSigned(slope)} tone={slope >= 0 ? "buy" : "sell"} />
          <Stat label="Price 1 min" value={formatSigned(priceMove, 2)} tone={priceMove >= 0 ? "buy" : "sell"} />
          <Stat
            label="Flow vs price"
            value={divergence ? "Divergent" : "Aligned"}
            tone={divergence ? "warn" : "muted"}
            title="Compares the sign of the 1-minute CVD change with the 1-minute price change"
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
