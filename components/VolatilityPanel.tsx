"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import {
  averageTrueRange,
  parkinsonVolatility,
  percentileRank,
  resampleBars,
  rollingRealizedVolatility,
  secondsPerYear,
  type VolatilityPoint,
} from "@/lib/engine/analytics";
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
import { formatClock, formatPriceValue, priceDecimals } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { Timeframe } from "@/lib/types/market";

// ─── Realized Volatility ─────────────────────────────────────────
// Rolling close-to-close realized volatility from log returns of
// fixed time bars, annualized:  RV = √(mean r²) · √(bars per year).
// Complemented by candle-based ATR and Parkinson (high-low) estimators.

const WINDOWS = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
  { value: 120, label: "120" },
] as const;
type Resolution = (typeof RESOLUTIONS)[number]["value"];
type Window = (typeof WINDOWS)[number]["value"];

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400,
};

function regime(percentile: number): { label: string; tone: "muted" | "accent" | "warn" | "sell" } {
  if (percentile >= 90) return { label: "Extreme", tone: "sell" };
  if (percentile >= 70) return { label: "Elevated", tone: "warn" };
  if (percentile >= 30) return { label: "Normal", tone: "accent" };
  return { label: "Compressed", tone: "muted" };
}

export default function VolatilityPanel() {
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const candles = useSessionStore((s) => s.candles);
  const currentCandle = useSessionStore((s) => s.currentCandle);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const tickSize = useSessionStore((s) => s.tickSize);
  const crosshairTime = useSessionStore((s) => s.crosshairTime);
  const [resolution, setResolution] = useState<Resolution>(15);
  const [window, setWindow] = useState<Window>(60);
  const visibleRef = useRef<{ points: VolatilityPoint[]; slot: number; plotR: number }>({ points: [], slot: 0, plotR: 0 });

  const yearSeconds = secondsPerYear(marketType);
  const series = useMemo(() => {
    const bars = liveBar ? [...flowBars, liveBar] : flowBars;
    return rollingRealizedVolatility(resampleBars(bars, resolution), window, resolution, yearSeconds);
  }, [flowBars, liveBar, resolution, window, yearSeconds]);

  const values = useMemo(() => series.map((pt) => pt.value).filter((v): v is number => v !== null), [series]);
  const current = values[values.length - 1] ?? null;
  const pct = current === null ? 50 : percentileRank(values, current);
  const reg = regime(pct);
  const median = useMemo(() => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [values]);

  const allCandles = useMemo(() => (currentCandle ? [...candles, currentCandle] : candles), [candles, currentCandle]);
  const completed = candles.filter((c) => c.tradeCount > 0);
  const atr = averageTrueRange(completed.length ? completed : allCandles, 14);
  const parkinson = parkinsonVolatility(completed.slice(-30), TIMEFRAME_SECONDS[timeframe], yearSeconds);
  const lastPrice = allCandles[allCandles.length - 1]?.close ?? 0;
  const liveRange = currentCandle && Number.isFinite(currentCandle.high) ? currentCandle.high - currentCandle.low : null;
  const expansion = atr && liveRange !== null ? liveRange / atr : null;
  const decimals = priceDecimals(tickSize, lastPrice);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 8;
      const plotB = H - STUDY_TIME_H;
      const ready = series.filter((pt) => pt.value !== null);
      if (ready.length < 2) {
        drawEmpty(ctx, W, H, `Collecting ${resolution}s returns for realized volatility…`, p);
        visibleRef.current = { points: [], slot: 0, plotR };
        return;
      }
      const capacity = Math.max(10, Math.floor(plotR / 2));
      const points = ready.slice(-capacity);
      const slot = plotR / Math.max(points.length - 1, 1);
      const xOf = (i: number) => i * slot;
      const vals = points.map((pt) => pt.value as number);
      const max = Math.max(...vals) * 1.15 || 1;
      const yOf = (v: number) => plotT + ((max - v) / max) * (plotB - plotT);

      drawValueAxis(ctx, 0, max, yOf, plotR, plotT, plotB, W, p, (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`);

      // Percentile bands (70th / 90th) of the session distribution.
      const sorted = [...values].sort((a, b) => a - b);
      const p70 = sorted[Math.floor(sorted.length * 0.7)];
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      if (p70 !== undefined && p90 !== undefined) {
        ctx.fillStyle = withAlpha(p.warn, 0.06);
        ctx.fillRect(0, yOf(Math.min(max, p90)), plotR, yOf(p70) - yOf(Math.min(max, p90)));
        ctx.fillStyle = withAlpha(p.sell, 0.06);
        ctx.fillRect(0, plotT, plotR, Math.max(0, yOf(Math.min(max, p90)) - plotT));
      }
      if (median !== null) {
        ctx.strokeStyle = withAlpha(p.textSecondary, 0.5);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yOf(median)) + 0.5);
        ctx.lineTo(plotR, Math.round(yOf(median)) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Area + line
      const grad = ctx.createLinearGradient(0, plotT, 0, plotB);
      grad.addColorStop(0, withAlpha(p.warn, 0.28));
      grad.addColorStop(1, withAlpha(p.warn, 0.02));
      ctx.beginPath();
      ctx.moveTo(xOf(0), plotB);
      vals.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(vals.length - 1), plotB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      vals.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
      ctx.strokeStyle = p.warn;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const last = vals[vals.length - 1];
      drawAxisTag(ctx, yOf(last), plotR, W, `${last.toFixed(1)}%`, p.warn, p);
      if (median !== null) {
        ctx.fillStyle = p.textMuted;
        ctx.font = monoFont(9, 600);
        ctx.textAlign = "left";
        ctx.fillText("MEDIAN", 6, yOf(median) - 6);
      }

      drawTimeAxis(ctx, points.map((pt) => pt.time), xOf, plotB, W, p, resolution < 60);
      if (crosshairTime !== null) {
        const idx = (crosshairTime - points[0].time) / (resolution * 1000);
        if (idx >= 0 && idx <= points.length - 1) drawCrosshairX(ctx, xOf(idx), plotT, plotB, p);
      }
      visibleRef.current = { points, slot, plotR };
    },
    [series, values, median, crosshairTime, resolution]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { points, slot, plotR } = visibleRef.current;
    if (!points.length || x > plotR) return hideTooltip();
    const pt = points[Math.round(x / slot)];
    if (!pt || pt.value === null) return hideTooltip();
    const r = regime(percentileRank(values, pt.value));
    showTooltip(
      `Realized vol ${pt.value.toFixed(2)}%`,
      [
        `Time: ${formatClock(pt.time)}`,
        `Window: ${window} × ${resolution === 60 ? "1m" : `${resolution}s`} returns`,
        `Session percentile: ${percentileRank(values, pt.value).toFixed(0)}th`,
        `Regime: ${r.label}`,
        "",
        "What this means: Annualized standard deviation of log returns over the window. It measures how much price is moving, independent of volume.",
      ].join("\n"),
      e
    );
  };

  return (
    <Panel
      title="Realized Volatility" icon={<Icon.Pulse />}
      subtitle={`annualized · ${window} × ${resolution === 60 ? "1m" : `${resolution}s`} log returns`}
      value={<span className={`tone-${reg.tone}`}>{current === null ? "—" : `${current.toFixed(1)}%`}</span>}
      actions={
        <>
          <Segmented size="xs" value={resolution} onChange={setResolution} options={RESOLUTIONS} ariaLabel="Return interval" />
          <Segmented size="xs" value={window} onChange={setWindow} options={WINDOWS} ariaLabel="Lookback window" />
        </>
      }
      footer={
        <div className="study-stats">
          <Stat label="Regime" value={reg.label} sub={current === null ? undefined : `p${pct.toFixed(0)}`} tone={reg.tone} />
          <Stat
            label={`ATR 14 · ${timeframe}`}
            value={atr === null ? "—" : formatPriceValue(atr, decimals)}
            sub={atr && lastPrice ? `${((atr / lastPrice) * 100).toFixed(2)}%` : undefined}
          />
          <Stat
            label="Range / ATR"
            value={expansion === null ? "—" : `${expansion.toFixed(2)}×`}
            tone={expansion !== null && expansion >= 1.5 ? "warn" : undefined}
            title="Live candle range relative to ATR — above 1× means the candle is already wider than average"
          />
          <Stat
            label="Parkinson"
            value={parkinson === null ? "—" : `${parkinson.toFixed(1)}%`}
            title={`High-low volatility estimator over the last ${Math.min(30, completed.length)} ${timeframe} candles, annualized`}
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
