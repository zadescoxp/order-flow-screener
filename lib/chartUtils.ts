// Small shared helpers for the canvas study panels.

import { monoFont, withAlpha, type Palette } from "@/hooks/useCanvas";
import { formatHM, formatClock } from "@/lib/format";

export const STUDY_AXIS_W = 52;
export const STUDY_TIME_H = 16;

export function niceStep(range: number, targetTicks: number): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const raw = range / Math.max(1, targetTicks);
  const exp = Math.floor(Math.log10(raw));
  const mag = 10 ** exp;
  const n = raw / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/** Bottom time axis with labels spaced at least `minGap` pixels apart. */
export function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  times: number[],
  xOf: (index: number) => number,
  y: number,
  width: number,
  p: Palette,
  withSeconds: boolean,
  minGap = 70
) {
  ctx.fillStyle = p.bgPanel;
  ctx.fillRect(0, y, width, STUDY_TIME_H);
  ctx.font = monoFont(9);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = p.textMuted;
  let lastX = -Infinity;
  for (let i = 0; i < times.length; i++) {
    const x = xOf(i);
    if (x - lastX < minGap || x < 24 || x > width - STUDY_AXIS_W - 20) continue;
    ctx.fillText(withSeconds ? formatClock(times[i]) : formatHM(times[i]), x, y + STUDY_TIME_H / 2 + 1);
    lastX = x;
  }
}

/** Right-side value axis with horizontal guide lines. */
export function drawValueAxis(
  ctx: CanvasRenderingContext2D,
  min: number,
  max: number,
  yOf: (value: number) => number,
  plotR: number,
  plotT: number,
  plotB: number,
  width: number,
  p: Palette,
  format: (value: number) => string,
  ticks = 4
) {
  ctx.fillStyle = p.bgPanel;
  ctx.fillRect(plotR, 0, width - plotR, plotB);
  const step = niceStep(max - min, ticks);
  ctx.font = monoFont(9);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) {
    const y = Math.round(yOf(v)) + 0.5;
    if (y < plotT + 4 || y > plotB - 4) continue;
    ctx.strokeStyle = p.grid;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.textMuted;
    ctx.fillText(format(v), width - 6, y);
  }
}

export function drawAxisTag(
  ctx: CanvasRenderingContext2D,
  y: number,
  plotR: number,
  width: number,
  text: string,
  color: string,
  p: Palette
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(plotR + 4, y - 8, width - plotR - 6, 16, 8);
  ctx.fill();
  ctx.fillStyle = p.light ? "#ffffff" : p.bgBase;
  ctx.font = monoFont(9, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, (plotR + 4 + width - 2) / 2, y + 0.5);
}

export function drawCrosshairX(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, p: Palette) {
  ctx.strokeStyle = withAlpha(p.textSecondary, 0.4);
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, top);
  ctx.lineTo(Math.round(x) + 0.5, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawEmpty(ctx: CanvasRenderingContext2D, width: number, height: number, text: string, p: Palette) {
  ctx.fillStyle = p.textMuted;
  ctx.font = monoFont(10);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}

export const RESOLUTIONS = [
  { value: 1, label: "1s" },
  { value: 5, label: "5s" },
  { value: 15, label: "15s" },
  { value: 60, label: "1m" },
] as const;
