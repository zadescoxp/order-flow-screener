// ============================================================
// 3D SURFACES
// Once-a-second columns for four time × Y × Z surfaces:
//
//   liquidity    time × distance from mid (bps) × cumulative resting notional
//   liquidation  time × price × estimated liquidation notional (a model)
//   funding      time × venue × annualized funding / mark premium
//   flow         time × price × net ΔOI / volume / delta
//
// Each surface keeps a ring of columns; the frame builders resample a
// window of them into a dense grid the 3D renderer can mesh. Pure, so
// live feeds and replays drive it the same way.
// ============================================================

import type { DepthSide } from "@/lib/engine/depthHistory";
import { fundingRate8h } from "@/lib/engine/derivatives";
import type { DerivativesSnapshot, TradeSide, Venue } from "@/lib/types/market";

export type SurfaceKind = "liquidity" | "liquidation" | "funding" | "flow";

export const SURFACE_INTERVAL_MS = 1000;
/** Thirty minutes of one-second columns per surface. */
export const SURFACE_CAPACITY = 1800;
/** Columns a frame resamples to at most (one mesh vertex per column). */
export const MAX_FRAME_COLS = 240;
/** Rows a price-binned frame merges to at most. */
export const MAX_FRAME_ROWS = 160;

// Liquidity: cumulative depth sampled every LIQUIDITY_STEP_BPS out to ±LIQUIDITY_BAND_BPS.
export const LIQUIDITY_BAND_BPS = 100;
export const LIQUIDITY_STEP_BPS = 2;
export const LIQUIDITY_HALF = LIQUIDITY_BAND_BPS / LIQUIDITY_STEP_BPS; // rows each side of mid
export const LIQUIDITY_ROWS = LIQUIDITY_HALF * 2 + 1;

/**
 * Leverage mix assumed for new positions, and the maintenance margin used to
 * place their liquidation price. Exchanges don't publish positions, so the
 * liquidation surface is an estimate built from the session's ΔOI.
 */
export const LEVERAGE_TIERS: readonly { leverage: number; weight: number }[] = [
  { leverage: 10, weight: 0.15 },
  { leverage: 25, weight: 0.3 },
  { leverage: 50, weight: 0.3 },
  { leverage: 100, weight: 0.25 },
];
export const MAINTENANCE_MARGIN = 0.004;
/** Model levels this far from the price are dropped (no tier reaches them). */
const MODEL_PRUNE_FRACTION = 0.2;

// ─── Column types ────────────────────────────────────────────────
interface Timed { time: number }

export interface LiquidityColumn extends Timed {
  mid: number;
  /** Cumulative notional from the mid outward; index LIQUIDITY_HALF is the mid. */
  depth: Float32Array;
}

export interface LiquidationColumn extends Timed {
  price: number;
  bins: Int32Array; // price bin = round(price / binSize), ascending
  long: Float32Array; // estimated long liquidation notional per bin
  short: Float32Array; // estimated short liquidation notional per bin
}

export interface FlowColumn extends Timed {
  price: number;
  high: number;
  low: number;
  bins: Int32Array;
  buy: Float32Array; // aggressive buy notional
  sell: Float32Array; // aggressive sell notional
  doi: Float32Array; // ΔOI notional attributed to the bin
}

export interface FundingColumn extends Timed {
  apr: Float32Array; // annualized funding (%), per engine venue; NaN until reported
  premium: Float32Array; // (mark − index) / index in bps, per venue; NaN until reported
}

export class ColumnRing<T extends Timed> {
  private items: (T | undefined)[];
  private next = 0;

  constructor(private readonly capacity = SURFACE_CAPACITY) {
    this.items = new Array(capacity);
  }

  get size(): number { return Math.min(this.next, this.capacity); }

  get last(): T | undefined {
    return this.next ? this.items[(this.next - 1) % this.capacity] : undefined;
  }

  push(item: T): void {
    const last = this.last;
    if (last && last.time === item.time) {
      this.items[(this.next - 1) % this.capacity] = item; // same second: replace
      return;
    }
    this.items[this.next % this.capacity] = item;
    this.next++;
  }

  clear(): void {
    this.items = new Array(this.capacity);
    this.next = 0;
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = [];
    for (let seq = this.next - this.size; seq < this.next; seq++) out.push(this.items[seq % this.capacity]!);
    return out;
  }
}

/** A round bin about 5 bps of the price (1, 2, 2.5 or 5 × a power of ten). */
export function niceBinSize(price: number, bps = 5): number {
  const raw = price * bps * 1e-4;
  if (!(raw > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = unit < 1.5 ? 1 : unit < 2.25 ? 2 : unit < 3.5 ? 2.5 : unit < 7.5 ? 5 : 10;
  return step * power;
}

/** Long and short liquidation prices for a position opened at `entry`. */
export function liquidationPrices(entry: number, leverage: number, mmr = MAINTENANCE_MARGIN): { long: number; short: number } {
  return {
    long: entry * (1 - 1 / leverage + mmr),
    short: entry * (1 + 1 / leverage - mmr),
  };
}

export interface SurfaceSampleInput {
  /** Each venue's book as price → size pairs. */
  sides: DepthSide[];
  mid: number;
  derivatives: DerivativesSnapshot[];
  /** Summed open interest in base units (perpetuals), or null. */
  openInterest: number | null;
  lastPrice: number;
}

// ─── Engine ──────────────────────────────────────────────────────
export class SurfaceEngine {
  /** Bumped on every sample so the view knows when to rebuild. */
  version = 0;
  binSize = 0;
  venues: Venue[] = [];
  lastTime = 0;

  readonly liquidity = new ColumnRing<LiquidityColumn>();
  readonly liquidation = new ColumnRing<LiquidationColumn>();
  readonly flow = new ColumnRing<FlowColumn>();
  readonly funding = new ColumnRing<FundingColumn>();

  private model = new Map<number, { long: number; short: number }>();
  private lastOI: number | null = null;
  // The second being accumulated from trades.
  private secBuy = new Map<number, number>();
  private secSell = new Map<number, number>();
  private secHigh = 0;
  private secLow = 0;
  private secQty = 0;
  private secNotional = 0;

  setVenues(venues: Venue[]): void {
    this.venues = [...venues];
  }

  clear(): void {
    this.liquidity.clear();
    this.liquidation.clear();
    this.flow.clear();
    this.funding.clear();
    this.model.clear();
    this.lastOI = null;
    this.binSize = 0;
    this.lastTime = 0;
    this.resetSecond();
    this.version++;
  }

  private resetSecond(): void {
    this.secBuy = new Map();
    this.secSell = new Map();
    this.secHigh = 0;
    this.secLow = 0;
    this.secQty = 0;
    this.secNotional = 0;
  }

  onTrade(price: number, quantity: number, side: TradeSide): void {
    if (!(price > 0) || !(quantity > 0)) return;
    if (!this.binSize) this.binSize = niceBinSize(price);
    const bin = Math.round(price / this.binSize);
    const notional = price * quantity;
    const target = side === "buy" ? this.secBuy : this.secSell;
    target.set(bin, (target.get(bin) ?? 0) + notional);
    this.secHigh = this.secQty ? Math.max(this.secHigh, price) : price;
    this.secLow = this.secQty ? Math.min(this.secLow, price) : price;
    this.secQty += quantity;
    this.secNotional += notional;
  }

  sample(now: number, input: SurfaceSampleInput): void {
    const time = Math.floor(now / SURFACE_INTERVAL_MS) * SURFACE_INTERVAL_MS;
    const price = this.secQty ? this.secNotional / this.secQty : input.lastPrice;
    if (!this.binSize && price > 0) this.binSize = niceBinSize(price);

    this.sampleLiquidity(time, input.sides, input.mid);
    const deltaOI = this.sampleLiquidation(time, input.openInterest, price);
    this.sampleFlow(time, price, deltaOI);
    this.sampleFunding(time, input.derivatives);

    this.resetSecond();
    this.lastTime = time;
    this.version++;
  }

  private sampleLiquidity(time: number, sides: DepthSide[], mid: number): void {
    if (!(mid > 0) || !sides.length) return;
    const bidSteps = new Float64Array(LIQUIDITY_HALF + 1);
    const askSteps = new Float64Array(LIQUIDITY_HALF + 1);
    let any = false;
    for (const side of sides) {
      for (const [levels, steps, sign] of [[side.bids, bidSteps, 1], [side.asks, askSteps, -1]] as const) {
        for (const [levelPrice, size] of levels) {
          if (!(size > 0) || !(levelPrice > 0)) continue;
          // Distance from the mid toward the side's own direction, in bps.
          const bps = ((mid - levelPrice) / mid) * 1e4 * sign;
          if (bps > LIQUIDITY_BAND_BPS || bps < -LIQUIDITY_STEP_BPS) continue; // crossed or out of band
          const step = Math.min(LIQUIDITY_HALF, Math.max(0, Math.ceil(bps / LIQUIDITY_STEP_BPS)));
          steps[step] += levelPrice * size;
          any = true;
        }
      }
    }
    if (!any) return;
    const depth = new Float32Array(LIQUIDITY_ROWS);
    let bidSum = 0;
    let askSum = 0;
    for (let k = 0; k <= LIQUIDITY_HALF; k++) {
      bidSum += bidSteps[k];
      askSum += askSteps[k];
      if (k === 0) continue;
      depth[LIQUIDITY_HALF - k] = bidSum;
      depth[LIQUIDITY_HALF + k] = askSum;
    }
    // At the mid itself nothing rests; the touch levels show one step out.
    depth[LIQUIDITY_HALF] = 0;
    this.liquidity.push({ time, mid, depth });
  }

  /** Update the liquidation model; returns ΔOI (base units) for the flow surface. */
  private sampleLiquidation(time: number, openInterest: number | null, price: number): number {
    if (openInterest == null || !(openInterest > 0) || !(price > 0) || !this.binSize) return 0;
    const previous = this.lastOI;
    this.lastOI = openInterest;
    const high = this.secQty ? this.secHigh : price;
    const low = this.secQty ? this.secLow : price;
    const bin = this.binSize;

    // Price traded through these levels during the second: they were liquidated.
    const lowBin = Math.round(low / bin);
    const highBin = Math.round(high / bin);
    for (const [b, level] of this.model) {
      if (b >= lowBin) level.long = 0;
      if (b <= highBin) level.short = 0;
    }

    const deltaOI = previous == null ? 0 : openInterest - previous;
    if (deltaOI > 0) {
      // Every new contract is one new long and one new short. Lean the
      // leveraged share toward the aggressor of the second.
      let buy = 0;
      let sell = 0;
      for (const v of this.secBuy.values()) buy += v;
      for (const v of this.secSell.values()) sell += v;
      const imbalance = buy + sell > 0 ? (buy - sell) / (buy + sell) : 0;
      const longShare = 0.5 + 0.25 * imbalance;
      const notional = deltaOI * price;
      for (const { leverage, weight } of LEVERAGE_TIERS) {
        const at = liquidationPrices(price, leverage);
        this.addModel(Math.round(at.long / bin), notional * weight * longShare, 0);
        this.addModel(Math.round(at.short / bin), 0, notional * weight * (1 - longShare));
      }
    } else if (deltaOI < 0 && previous) {
      // Positions closed; we can't know which, so shrink every level evenly.
      const keep = Math.max(0, 1 + deltaOI / previous);
      for (const level of this.model.values()) {
        level.long *= keep;
        level.short *= keep;
      }
    }

    const priceBin = Math.round(price / bin);
    const pruneBins = (price * MODEL_PRUNE_FRACTION) / bin;
    const keys = [...this.model.keys()].sort((a, b) => a - b);
    const bins: number[] = [];
    const longs: number[] = [];
    const shorts: number[] = [];
    for (const b of keys) {
      const level = this.model.get(b)!;
      if (Math.abs(b - priceBin) > pruneBins || (level.long < 1e-9 && level.short < 1e-9)) {
        this.model.delete(b);
        continue;
      }
      bins.push(b);
      longs.push(level.long);
      shorts.push(level.short);
    }
    this.liquidation.push({
      time,
      price,
      bins: Int32Array.from(bins),
      long: Float32Array.from(longs),
      short: Float32Array.from(shorts),
    });
    return deltaOI;
  }

  private addModel(bin: number, long: number, short: number): void {
    const level = this.model.get(bin);
    if (level) {
      level.long += long;
      level.short += short;
    } else this.model.set(bin, { long, short });
  }

  private sampleFlow(time: number, price: number, deltaOI: number): void {
    if (!this.binSize || !(price > 0)) return;
    if (!this.secQty && deltaOI === 0) return;
    const keys = new Set<number>([...this.secBuy.keys(), ...this.secSell.keys()]);
    const priceBin = Math.round(price / this.binSize);
    if (!keys.size) keys.add(priceBin);
    const bins = [...keys].sort((a, b) => a - b);
    const buy = new Float32Array(bins.length);
    const sell = new Float32Array(bins.length);
    const doi = new Float32Array(bins.length);
    let total = 0;
    bins.forEach((b, i) => {
      buy[i] = this.secBuy.get(b) ?? 0;
      sell[i] = this.secSell.get(b) ?? 0;
      total += buy[i] + sell[i];
    });
    // ΔOI goes where the second's volume traded; with no trades, at the price.
    const doiNotional = deltaOI * price;
    if (doiNotional !== 0) {
      bins.forEach((b, i) => {
        doi[i] = total > 0 ? (doiNotional * (buy[i] + sell[i])) / total : b === priceBin ? doiNotional : 0;
      });
    }
    this.flow.push({
      time,
      price,
      high: this.secQty ? this.secHigh : price,
      low: this.secQty ? this.secLow : price,
      bins: Int32Array.from(bins),
      buy,
      sell,
      doi,
    });
  }

  private sampleFunding(time: number, derivatives: DerivativesSnapshot[]): void {
    if (!this.venues.length || !derivatives.length) return;
    const previous = this.funding.last;
    const n = this.venues.length;
    const apr = new Float32Array(n).fill(NaN);
    const premium = new Float32Array(n).fill(NaN);
    let any = false;
    this.venues.forEach((venue, i) => {
      const snapshot = derivatives.find((d) => d.venue === venue);
      const rate = snapshot ? fundingRate8h(snapshot) : undefined;
      if (rate !== undefined && Number.isFinite(rate)) {
        apr[i] = rate * 3 * 365 * 100;
        any = true;
      } else if (previous) apr[i] = previous.apr[i];
      const mark = snapshot?.markPrice;
      const index = snapshot?.indexPrice;
      if (mark && index && index > 0) {
        premium[i] = ((mark - index) / index) * 1e4;
        any = true;
      } else if (previous) premium[i] = previous.premium[i];
    });
    if (any) this.funding.push({ time, apr, premium });
  }
}

// ─── Frames ──────────────────────────────────────────────────────
/** A dense grid ready to mesh. values[col * rows + row]; NaN = no data. */
export interface SurfaceFrame {
  kind: SurfaceKind;
  cols: number;
  rows: number;
  values: Float32Array;
  /** Window start / end (ms); column c covers [t0 + c·dt, t0 + (c+1)·dt). */
  t0: number;
  t1: number;
  /** First column holding data (the surface grows in from the right). */
  firstCol: number;
  /** Numeric value of each row: bps from mid, price, or venue index. */
  rowValues: Float64Array;
  /** Price (or 0) per column as a fractional row, for the price trace. */
  path: Float32Array | null;
  /** Values below zero mean something (funding, delta, ΔOI). */
  signed: boolean;
  /** Row index at which the colour switches sides (bids → asks), or -1. */
  splitRow: number;
}

interface WindowSpec { windowMs: number; now: number }

function windowColumns({ windowMs, now }: WindowSpec): { cols: number; t0: number; t1: number; dt: number } {
  const t1 = Math.floor(now / SURFACE_INTERVAL_MS) * SURFACE_INTERVAL_MS + SURFACE_INTERVAL_MS;
  const seconds = Math.max(2, Math.round(windowMs / SURFACE_INTERVAL_MS));
  const cols = Math.min(MAX_FRAME_COLS, seconds);
  return { cols, t0: t1 - seconds * SURFACE_INTERVAL_MS, t1, dt: (seconds * SURFACE_INTERVAL_MS) / cols };
}

/**
 * Group a window's source columns into display columns. `last` is the latest
 * source column at or before each display column's end (forward-filled across
 * gaps); `members` are the source columns inside it.
 */
function bucket<T extends Timed>(items: T[], t0: number, dt: number, cols: number): { last: (T | null)[]; members: T[][]; first: number } {
  const last: (T | null)[] = new Array(cols).fill(null);
  const members: T[][] = Array.from({ length: cols }, () => []);
  let carry: T | null = null;
  let k = 0;
  let first = cols;
  for (let c = 0; c < cols; c++) {
    const end = t0 + (c + 1) * dt;
    while (k < items.length && items[k].time < end) {
      if (items[k].time >= t0) members[c].push(items[k]);
      carry = items[k];
      k++;
    }
    last[c] = carry;
    if (carry && first === cols) first = c;
  }
  return { last, members, first };
}

function emptyFrame(kind: SurfaceKind, cols: number, rows: number, t0: number, t1: number): SurfaceFrame {
  return {
    kind,
    cols,
    rows,
    values: new Float32Array(cols * rows).fill(NaN),
    t0,
    t1,
    firstCol: cols,
    rowValues: new Float64Array(rows),
    path: null,
    signed: false,
    splitRow: -1,
  };
}

export function buildLiquidityFrame(engine: SurfaceEngine, spec: WindowSpec & { bandBps: number }): SurfaceFrame {
  const { cols, t0, t1, dt } = windowColumns(spec);
  const half = Math.max(1, Math.min(LIQUIDITY_HALF, Math.round(spec.bandBps / LIQUIDITY_STEP_BPS)));
  const rows = half * 2 + 1;
  const frame = emptyFrame("liquidity", cols, rows, t0, t1);
  frame.splitRow = half;
  for (let r = 0; r < rows; r++) frame.rowValues[r] = (r - half) * LIQUIDITY_STEP_BPS;
  const { last, first } = bucket(engine.liquidity.toArray(), t0, dt, cols);
  frame.firstCol = first;
  for (let c = first; c < cols; c++) {
    const column = last[c];
    if (!column) continue;
    for (let r = 0; r < rows; r++) frame.values[c * rows + r] = column.depth[LIQUIDITY_HALF - half + r];
  }
  return frame;
}

/** Rows for a price window: bins from lo to hi merged so there are at most MAX_FRAME_ROWS. */
function priceRows(binSize: number, lo: number, hi: number): { firstBin: number; merge: number; rows: number } {
  const firstBin = Math.floor(lo / binSize);
  const lastBin = Math.ceil(hi / binSize);
  const span = Math.max(2, lastBin - firstBin + 1);
  const merge = Math.max(1, Math.ceil(span / MAX_FRAME_ROWS));
  return { firstBin, merge, rows: Math.max(2, Math.ceil(span / merge)) };
}

export function buildLiquidationFrame(engine: SurfaceEngine, spec: WindowSpec & { rangePct: number }): SurfaceFrame {
  const { cols, t0, t1, dt } = windowColumns(spec);
  const latest = engine.liquidation.last;
  if (!latest || !engine.binSize) return emptyFrame("liquidation", cols, 2, t0, t1);
  const span = latest.price * (spec.rangePct / 100);
  const { firstBin, merge, rows } = priceRows(engine.binSize, latest.price - span, latest.price + span);
  const frame = emptyFrame("liquidation", cols, rows, t0, t1);
  for (let r = 0; r < rows; r++) frame.rowValues[r] = (firstBin + r * merge + (merge - 1) / 2) * engine.binSize;
  frame.path = new Float32Array(cols).fill(NaN);
  const { last, first } = bucket(engine.liquidation.toArray(), t0, dt, cols);
  frame.firstCol = first;
  for (let c = first; c < cols; c++) {
    const column = last[c];
    if (!column) continue;
    const base = c * rows;
    frame.values.fill(0, base, base + rows);
    for (let i = 0; i < column.bins.length; i++) {
      const r = Math.floor((column.bins[i] - firstBin) / merge);
      if (r < 0 || r >= rows) continue;
      frame.values[base + r] += column.long[i] + column.short[i];
    }
    frame.path[c] = (column.price / engine.binSize - firstBin - (merge - 1) / 2) / merge;
  }
  return frame;
}

export type FlowMetric = "doi" | "volume" | "delta";

export function buildFlowFrame(engine: SurfaceEngine, spec: WindowSpec & { metric: FlowMetric; cumulative: boolean }): SurfaceFrame {
  const { cols, t0, t1, dt } = windowColumns(spec);
  const items = engine.flow.toArray().filter((column) => column.time >= t0);
  if (!items.length || !engine.binSize) return emptyFrame("flow", cols, 2, t0, t1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const column of items) {
    lo = Math.min(lo, column.low);
    hi = Math.max(hi, column.high);
  }
  // Pad so a quiet market still shows a few rows either side of the price.
  const pad = Math.max((hi - lo) * 0.08, engine.binSize * 6);
  const { firstBin, merge, rows } = priceRows(engine.binSize, lo - pad, hi + pad);
  const frame = emptyFrame("flow", cols, rows, t0, t1);
  frame.signed = spec.metric !== "volume";
  for (let r = 0; r < rows; r++) frame.rowValues[r] = (firstBin + r * merge + (merge - 1) / 2) * engine.binSize;
  frame.path = new Float32Array(cols).fill(NaN);
  const { members, first } = bucket(items, t0, dt, cols);
  frame.firstCol = first;
  const running = new Float64Array(rows);
  for (let c = first; c < cols; c++) {
    const base = c * rows;
    if (!spec.cumulative) running.fill(0);
    let price = NaN;
    for (const column of members[c]) {
      price = column.price;
      for (let i = 0; i < column.bins.length; i++) {
        const r = Math.floor((column.bins[i] - firstBin) / merge);
        if (r < 0 || r >= rows) continue;
        running[r] +=
          spec.metric === "volume" ? column.buy[i] + column.sell[i]
          : spec.metric === "delta" ? column.buy[i] - column.sell[i]
          : column.doi[i];
      }
    }
    for (let r = 0; r < rows; r++) frame.values[base + r] = running[r];
    if (Number.isFinite(price)) frame.path[c] = (price / engine.binSize - firstBin - (merge - 1) / 2) / merge;
    else if (c > first) frame.path[c] = frame.path[c - 1];
  }
  return frame;
}

export type FundingMetric = "apr" | "premium";

export function buildFundingFrame(engine: SurfaceEngine, spec: WindowSpec & { metric: FundingMetric }): { frame: SurfaceFrame; venues: Venue[] } {
  const { cols, t0, t1, dt } = windowColumns(spec);
  const items = engine.funding.toArray();
  // Only venues that have reported the metric at least once get a row.
  const latest = engine.funding.last;
  const rowsIdx = engine.venues
    .map((venue, i) => ({ venue, i }))
    .filter(({ i }) => latest && Number.isFinite((spec.metric === "apr" ? latest.apr : latest.premium)[i]));
  const rows = rowsIdx.length;
  const frame = emptyFrame("funding", cols, Math.max(rows, 1), t0, t1);
  frame.signed = true;
  if (!rows) return { frame: { ...frame, firstCol: cols }, venues: [] };
  rowsIdx.forEach((_, r) => (frame.rowValues[r] = r));
  const { last, first } = bucket(items, t0, dt, cols);
  frame.firstCol = first;
  for (let c = first; c < cols; c++) {
    const column = last[c];
    if (!column) continue;
    const source = spec.metric === "apr" ? column.apr : column.premium;
    rowsIdx.forEach(({ i }, r) => (frame.values[c * rows + r] = source[i]));
  }
  return { frame, venues: rowsIdx.map(({ venue }) => venue) };
}
