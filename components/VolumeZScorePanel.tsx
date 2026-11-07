"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { resampleBars, rollingVolumeZScores, type VolumeZPoint } from "@/lib/engine/analytics";
import { useCanvas, withAlpha, type Palette } from "@/hooks/useCanvas";
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
import { formatClock, formatCompact } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Volume Z-Score ──────────────────────────────────────────────
// How unusual is the volume traded in each time bucket compared with
// the preceding N buckets?   z = (Vₜ − μ) / σ   over bars t−N … t−1.
// This is an activity / participation signal — not volatility.

const WINDOWS = [
  { value: 20, label: "20" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
] as const;
type Resolution = (typeof RESOLUTIONS)[number]["value"];
type Window = (typeof WINDOWS)[number]["value"];
type View = "z" | "volume";

const BAR_SLOT_MIN = 5;

export function zTone(z: number | null): "sell" | "warn" | "accent" | "muted" {
  if (z === null) return "muted";
  if (z >= 3) return "sell";
  if (z >= 2) return "warn";
  if (z >= 1) return "accent";
  return "muted";
}

function zColor(z: number, p: Palette): string {
  if (z >= 3) return p.sell;
  if (z >= 2) return p.warn;
  if (z >= 1) return p.accent;
  if (z >= 0) return withAlpha(p.neutral, 0.8);
  return withAlpha(p.neutral, 0.45);
}

export default function VolumeZScorePanel() {
  const flowBars = useSessionStore((s) => s.flowBars);
  const liveBar = useSessionStore((s) => s.liveBar);
  const crosshairTime = useSessionStore((s) => s.crosshairTime);
  const marketType = useSessionStore((s) => s.marketType);
  const [resolution, setResolution] = useState<Resolution>(5);
  const [window, setWindow] = useState<Window>(20);
  const [view, setView] = useState<View>("z");
  const visibleRef = useRef<{ points: VolumeZPoint[]; slot: number; plotR: number }>({ points: [], slot: 0, plotR: 0 });

  const series = useMemo(() => {
    const bars = liveBar ? [...flowBars, liveBar] : flowBars;
    return rollingVolumeZScores(resampleBars(bars, resolution), window);
  }, [flowBars, liveBar, resolution, window]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 6;
      const plotB = H - STUDY_TIME_H;
      const scored = series.filter((point) => point.z !== null);
      if (scored.length < 2) {
        drawEmpty(ctx, W, H, `Collecting ${window} × ${resolution}s bars of volume history…`, p);
        visibleRef.current = { points: [], slot: 0, plotR };
        return;
      }
      const capacity = Math.max(10, Math.floor(plotR / BAR_SLOT_MIN));
      const points = scored.slice(-capacity);
      const slot = plotR / Math.max(points.length, Math.min(capacity, 60));
      const xOf = (i: number) => plotR - (points.length - i) * slot + slot / 2;
      const barW = Math.max(1, slot * 0.72);

      if (view === "z") {
        const zs = points.map((pt) => pt.z ?? 0);
        const max = Math.min(10, Math.max(3.5, ...zs) + 0.3);
        const min = Math.max(-4, Math.min(-1.5, ...zs) - 0.2);
        const yOf = (v: number) => plotT + ((max - v) / (max - min)) * (plotB - plotT);
        drawValueAxis(ctx, min, max, yOf, plotR, plotT, plotB, W, p, (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}σ`);
        // Threshold bands
        ctx.fillStyle = withAlpha(p.warn, 0.05);
        ctx.fillRect(0, yOf(max), plotR, yOf(2) - yOf(max));
        for (const level of [1, 2, 3]) {
          const y = Math.round(yOf(level)) + 0.5;
          ctx.strokeStyle = withAlpha(level === 3 ? p.sell : level === 2 ? p.warn : p.accent, 0.5);
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotR, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const y0 = yOf(0);
        ctx.fillStyle = p.border;
        ctx.fillRect(0, Math.round(y0), plotR, 1);
        points.forEach((pt, i) => {
          const z = pt.z ?? 0;
          const y = yOf(z);
          ctx.fillStyle = zColor(z, p);
          ctx.beginPath();
          ctx.roundRect(xOf(i) - barW / 2, Math.min(y, y0), barW, Math.max(1.5, Math.abs(y - y0)), Math.min(2.5, barW / 2));
          ctx.fill();
        });
        const last = points[points.length - 1].z ?? 0;
        drawAxisTag(ctx, yOf(last), plotR, W, `${last >= 0 ? "+" : ""}${last.toFixed(2)}`, zColor(Math.max(last, 1), p), p);
      } else {
        const max = Math.max(...points.map((pt) => Math.max(pt.volume, (pt.mean ?? 0) + 2 * (pt.std ?? 0)))) * 1.08 || 1;
        const yOf = (v: number) => plotT + ((max - v) / max) * (plotB - plotT);
        drawValueAxis(ctx, 0, max, yOf, plotR, plotT, plotB, W, p, (v) => formatCompact(v));
        points.forEach((pt, i) => {
          const x = xOf(i) - barW / 2;
          const yBuy = yOf(pt.buyVolume);
          const yTotal = yOf(pt.volume);
          const spike = (pt.z ?? 0) >= 2;
          const r = Math.min(2.5, barW / 2);
          ctx.fillStyle = withAlpha(p.buy, spike ? 0.95 : 0.6);
          ctx.beginPath();
          ctx.roundRect(x, yBuy + 0.5, barW, Math.max(0, plotB - yBuy - 0.5), r);
          ctx.fill();
          ctx.fillStyle = withAlpha(p.sell, spike ? 0.95 : 0.6);
          ctx.beginPath();
          ctx.roundRect(x, yTotal, barW, Math.max(0, yBuy - yTotal - 1), r);
          ctx.fill();
          if (spike) {
            ctx.fillStyle = p.warn;
            ctx.fillRect(x, yTotal - 3, barW, 2);
          }
        });
        const line = (value: (pt: VolumeZPoint) => number | null, color: string, dash: number[]) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.25;
          ctx.setLineDash(dash);
          ctx.beginPath();
          let started = false;
          points.forEach((pt, i) => {
            const v = value(pt);
            if (v === null) return;
            const y = yOf(v);
            if (!started) { ctx.moveTo(xOf(i), y); started = true; } else ctx.lineTo(xOf(i), y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        };
        line((pt) => pt.mean, p.accent, []);
        line((pt) => (pt.mean === null || pt.std === null ? null : pt.mean + 2 * pt.std), p.warn, [4, 3]);
      }

      drawTimeAxis(ctx, points.map((pt) => pt.time), xOf, plotB, W, p, resolution < 60);

      if (crosshairTime !== null) {
        const first = points[0].time;
        const span = resolution * 1000;
        const index = (crosshairTime - first) / span;
        if (index >= 0 && index <= points.length) drawCrosshairX(ctx, xOf(Math.min(points.length - 1, index)), plotT, plotB, p);
      }
      visibleRef.current = { points, slot, plotR };
    },
    [series, view, crosshairTime, resolution, window]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { points, slot, plotR } = visibleRef.current;
    if (!points.length || x > plotR) return hideTooltip();
    const index = Math.floor((x - (plotR - points.length * slot)) / slot);
    const pt = points[index];
    if (!pt) return hideTooltip();
    const z = pt.z ?? 0;
    const label = z >= 3 ? "Extreme participation" : z >= 2 ? "Volume spike" : z >= 1 ? "Above average" : z <= -1 ? "Quiet" : "Normal";
    showTooltip(
      `Volume z-score ${z >= 0 ? "+" : ""}${z.toFixed(2)}σ`,
      [
        `Bar: ${formatClock(pt.time)} (${resolution}s)`,
        `Volume: ${formatCompact(pt.volume, 3)}`,
        `Buy / Sell: ${formatCompact(pt.buyVolume, 2)} / ${formatCompact(pt.sellVolume, 2)}`,
        `Baseline mean: ${formatCompact(pt.mean ?? 0, 3)}`,
        `Baseline σ: ${formatCompact(pt.std ?? 0, 3)}`,
        `Reading: ${label}`,
        "",
        `What this means: Compares this bar's traded volume with the previous ${window} bars. It measures participation, not price volatility.`,
      ].join("\n"),
      e
    );
  };

  const last = series[series.length - 1];
  const lastZ = last?.z ?? null;
  const visible = series.slice(-200).filter((pt) => pt.z !== null);
  const spikes = visible.filter((pt) => (pt.z ?? 0) >= 2).length;
  const maxZ = visible.reduce((m, pt) => Math.max(m, pt.z ?? -Infinity), -Infinity);
  const unit = marketType === "forex" ? "ticks" : "vol";

  return (
    <Panel
      title="Volume Z-Score" icon={<Icon.Bars />}
      subtitle={`${marketType === "forex" ? "tick volume" : "volume"} vs prior ${window} × ${resolution === 60 ? "1m" : `${resolution}s`}`}
      value={
        <span className={`tone-${zTone(lastZ)}`}>
          {lastZ === null ? "—" : `${lastZ >= 0 ? "+" : ""}${lastZ.toFixed(2)}σ`}
        </span>
      }
      actions={
        <>
          <Segmented size="xs" value={view} onChange={setView} options={[{ value: "z", label: "Z" }, { value: "volume", label: "Bars" }]} ariaLabel="View" />
          <Segmented size="xs" value={resolution} onChange={setResolution} options={RESOLUTIONS} ariaLabel="Bar size" />
          <Segmented size="xs" value={window} onChange={setWindow} options={WINDOWS} ariaLabel="Lookback window" />
        </>
      }
      footer={
        <div className="study-stats">
          <Stat label={`μ ${unit}/bar`} value={formatCompact(last?.mean ?? 0, 2)} />
          <Stat label="σ" value={formatCompact(last?.std ?? 0, 2)} />
          <Stat label="≥2σ (200)" value={spikes} tone={spikes ? "warn" : undefined} />
          <Stat label="Max z" value={Number.isFinite(maxZ) ? `${maxZ.toFixed(1)}σ` : "—"} tone={zTone(Number.isFinite(maxZ) ? maxZ : null)} />
        </div>
      }
    >
      <div ref={containerRef} className="canvas-host" onMouseMove={handleMove} onMouseLeave={hideTooltip}>
        <canvas ref={canvasRef} />
      </div>
    </Panel>
  );
}
