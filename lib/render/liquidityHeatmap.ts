// ============================================================
// RESTING-LIQUIDITY HEATMAP RENDERER
// Keeps an offscreen grid with one pixel column per depth snapshot and one
// pixel row per tick, indexed by `seq % capacity` so the ring never needs a
// shift. Each frame stretches the relevant columns into the footprint's
// candle columns with drawImage, which is cheap even while panning.
// ============================================================

import { DEPTH_INTERVAL_MS, depthPercentile, type DepthHistory } from "@/lib/engine/depthHistory";
import type { FootprintCandle } from "@/lib/types/market";

const RANGE_MARGIN = 0.25; // extra rows above/below the observed range
const MAX_ROWS = 4000;
const RESCALE_EVERY = 30; // snapshots between colour-scale checks
const RESCALE_DRIFT = 0.35; // rebuild when the 97th percentile moves this much

// Dark blue → cyan → yellow → white, the usual depth-heatmap ramp.
const STOPS: [number, number, number, number, number][] = [
  [0.0, 10, 20, 50, 0],
  [0.12, 22, 48, 110, 0.35],
  [0.35, 24, 116, 196, 0.6],
  [0.6, 56, 206, 205, 0.78],
  [0.82, 248, 226, 110, 0.9],
  [1.0, 255, 255, 255, 1],
];

function buildLut(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
    const [t0, r0, g0, b0, a0] = STOPS[k - 1];
    const [t1, r1, g1, b1, a1] = STOPS[k];
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const r = Math.round(r0 + (r1 - r0) * f);
    const g = Math.round(g0 + (g1 - g0) * f);
    const b = Math.round(b0 + (b1 - b0) * f);
    const a = Math.round((a0 + (a1 - a0) * f) * 255);
    lut[i] = (a << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA
  }
  return lut;
}

export interface HeatmapLayout {
  candles: FootprintCandle[];
  startIndex: number;
  colX: (index: number) => number;
  colW: number;
  plotR: number;
  priceY: (price: number) => number;
  rowH: number;
}

export class LiquidityHeatmapRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly lut = buildLut();
  private epoch = -1;
  private tick = 0;
  private minIdx = 0;
  private maxIdx = -1;
  private cap = 0;
  private builtThrough = -1; // last seq painted into the grid
  private lastScaleSeq = -1;

  constructor(private readonly capacity: number) {}

  /** Bring the grid up to date with the history. */
  update(history: DepthHistory): void {
    if (history.size === 0) return;
    const first = history.firstSeq;
    const last = history.lastSeq;
    let rebuild = history.epoch !== this.epoch || history.tick !== this.tick || !this.canvas;

    // Expand the price range when a snapshot falls outside it.
    for (let seq = Math.max(first, this.builtThrough + 1); seq <= last; seq++) {
      const snap = history.get(seq);
      if (!snap || !snap.index.length) continue;
      if (snap.index[0] < this.minIdx || snap.index[snap.index.length - 1] > this.maxIdx || this.maxIdx < this.minIdx) {
        rebuild = true;
        break;
      }
    }
    // Re-scale colours when the typical resting size drifts.
    if (!rebuild && last - this.lastScaleSeq >= RESCALE_EVERY) {
      const cap = depthPercentile(history, Math.max(first, last - 300), last, 0.98);
      this.lastScaleSeq = last;
      if (this.cap > 0 && Math.abs(cap - this.cap) / this.cap > RESCALE_DRIFT) rebuild = true;
    }

    if (rebuild) this.rebuild(history);
    else for (let seq = Math.max(first, this.builtThrough + 1); seq <= last; seq++) this.paint(history, seq);
    this.builtThrough = last;
  }

  private rebuild(history: DepthHistory): void {
    const first = history.firstSeq;
    const last = history.lastSeq;
    let lo = Infinity;
    let hi = -Infinity;
    for (let seq = first; seq <= last; seq++) {
      const snap = history.get(seq);
      if (!snap || !snap.index.length) continue;
      lo = Math.min(lo, snap.index[0]);
      hi = Math.max(hi, snap.index[snap.index.length - 1]);
    }
    if (!Number.isFinite(lo)) return;
    const margin = Math.max(20, Math.ceil((hi - lo) * RANGE_MARGIN));
    this.minIdx = lo - margin;
    this.maxIdx = hi + margin;
    if (this.maxIdx - this.minIdx + 1 > MAX_ROWS) {
      // Keep the most recent range if price travelled very far.
      const lastSnap = history.get(last)!;
      const mid = lastSnap.index[lastSnap.index.length >> 1];
      this.minIdx = mid - MAX_ROWS / 2;
      this.maxIdx = mid + MAX_ROWS / 2 - 1;
    }
    this.cap = depthPercentile(history, Math.max(first, last - 300), last, 0.98) || 1;
    this.lastScaleSeq = last;
    this.epoch = history.epoch;
    this.tick = history.tick;

    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    }
    this.canvas.width = this.capacity;
    this.canvas.height = this.maxIdx - this.minIdx + 1;
    for (let seq = first; seq <= last; seq++) this.paint(history, seq);
  }

  /** Paint one snapshot as a one-pixel column. */
  private paint(history: DepthHistory, seq: number): void {
    const snap = history.get(seq);
    if (!snap || !this.ctx || !this.canvas) return;
    const rows = this.canvas.height;
    const image = this.ctx.createImageData(1, rows);
    const pixels = new Uint32Array(image.data.buffer);
    const inv = 1 / (this.cap || 1);
    for (let i = 0; i < snap.index.length; i++) {
      const row = this.maxIdx - snap.index[i];
      if (row < 0 || row >= rows) continue;
      // Mild gamma: typical depth stays blue, only walls reach yellow / white.
      const t = Math.min(1, Math.pow(snap.size[i] * inv, 0.85));
      pixels[row] = this.lut[Math.round(t * 255)];
    }
    this.ctx.putImageData(image, seq % this.capacity, 0);
  }

  /** Draw the heatmap behind the candles. Call inside the plot clip. */
  draw(target: CanvasRenderingContext2D, history: DepthHistory, layout: HeatmapLayout, alpha = 0.72): void {
    if (!this.canvas || history.size === 0 || history.tick !== this.tick) return;
    const { candles, startIndex, colX, colW, plotR, priceY, rowH } = layout;
    const tick = this.tick;
    const top = priceY(this.maxIdx * tick);
    const height = (this.maxIdx - this.minIdx + 1) * rowH;
    target.save();
    target.imageSmoothingEnabled = false;
    target.globalAlpha = alpha;
    for (let ci = startIndex; ci < candles.length; ci++) {
      const candle = candles[ci];
      const x = colX(ci);
      if (x > plotR) break;
      const duration = candle.closeTime - candle.openTime + 1;
      let seq = history.seqAtOrAfter(candle.openTime);
      const end = history.seqAtOrAfter(candle.openTime + duration);
      // Draw contiguous runs of one-second snapshots.
      while (seq < end) {
        const runStart = seq;
        let prevTime = history.get(seq)!.time;
        seq++;
        while (seq < end) {
          const time = history.get(seq)!.time;
          if (time - prevTime > DEPTH_INTERVAL_MS * 1.5) break;
          prevTime = time;
          seq++;
        }
        const t0 = history.get(runStart)!.time;
        const t1 = prevTime + DEPTH_INTERVAL_MS;
        const x0 = x + ((t0 - candle.openTime) / duration) * colW;
        const x1 = x + ((Math.min(t1, candle.openTime + duration) - candle.openTime) / duration) * colW;
        this.blit(target, runStart, seq - runStart, x0, top, x1 - x0, height);
      }
    }
    target.restore();
  }

  /** Copy `count` columns starting at `seq` (wrapping around the ring) to a destination rect. */
  private blit(target: CanvasRenderingContext2D, seq: number, count: number, dx: number, dy: number, dw: number, dh: number) {
    const canvas = this.canvas!;
    const start = seq % this.capacity;
    const firstPart = Math.min(count, this.capacity - start);
    const perColumn = dw / count;
    target.drawImage(canvas, start, 0, firstPart, canvas.height, dx, dy, perColumn * firstPart, dh);
    if (firstPart < count) {
      target.drawImage(canvas, 0, 0, count - firstPart, canvas.height, dx + perColumn * firstPart, dy, perColumn * (count - firstPart), dh);
    }
  }

  /** Size at a price for the snapshot nearest `time` (tooltips). */
  static sizeAt(history: DepthHistory, time: number, price: number): number | null {
    if (history.size === 0 || !(history.tick > 0)) return null;
    const seq = Math.min(history.lastSeq, history.seqAtOrAfter(time));
    const snap = history.get(seq);
    if (!snap || Math.abs(snap.time - time) > DEPTH_INTERVAL_MS * 2) return null;
    const target = Math.round(price / history.tick);
    let lo = 0;
    let hi = snap.index.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (snap.index[mid] === target) return snap.size[mid];
      if (snap.index[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return 0;
  }
}
