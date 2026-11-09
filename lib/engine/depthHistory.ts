// ============================================================
// DEPTH HISTORY
// One-second snapshots of resting liquidity, summed across venues and
// bucketed to the footprint's tick, for the resting-liquidity heatmap.
// Stored as typed arrays in a ring so two hours cost a few megabytes.
// ============================================================

import type { NormalizedOrderBook } from "@/lib/types/market";

export interface DepthSnapshot {
  seq: number; // monotonically increasing across the session
  time: number; // second bucket (ms)
  index: Int32Array; // price bucket = round(price / tick), ascending
  size: Float32Array; // resting size (base units), bids + asks
}

export const DEPTH_INTERVAL_MS = 1000;
/** Levels further than this from the mid are ignored (full-depth books span huge ranges). */
export const DEPTH_BAND = 0.03;

export interface DepthSide {
  bids: Iterable<[number, number]> | ReadonlyMap<number, number>;
  asks: Iterable<[number, number]> | ReadonlyMap<number, number>;
}

/** Adapt an emitted book (level arrays) to price → size pairs. */
export function bookSides(book: NormalizedOrderBook): DepthSide {
  return {
    bids: book.bids.map((l) => [l.price, l.size] as [number, number]),
    asks: book.asks.map((l) => [l.price, l.size] as [number, number]),
  };
}
export const DEPTH_CAPACITY = 7200; // two hours

export class DepthHistory {
  private ring: (DepthSnapshot | undefined)[];
  private nextSeq = 0;
  private _tick = 0;
  /** Bumped on every change, so renderers know when to rebuild. */
  version = 0;
  /** Bumped when existing data is invalidated (tick change, clear). */
  epoch = 0;

  constructor(private readonly capacity = DEPTH_CAPACITY) {
    this.ring = new Array(capacity);
  }

  get tick(): number { return this._tick; }
  get size(): number { return Math.min(this.nextSeq, this.capacity); }
  get firstSeq(): number { return Math.max(0, this.nextSeq - this.capacity); }
  get lastSeq(): number { return this.nextSeq - 1; }

  clear(): void {
    this.ring = new Array(this.capacity);
    this.nextSeq = 0;
    this.version++;
    this.epoch++;
  }

  /**
   * Sum the venues' levels into tick buckets within ±DEPTH_BAND of `mid`
   * and append a snapshot. Returns the snapshot (for recording) or null.
   */
  add(time: number, sides: Iterable<DepthSide>, tick: number, mid: number): DepthSnapshot | null {
    if (!(tick > 0) || !(mid > 0)) return null;
    const lo = mid * (1 - DEPTH_BAND);
    const hi = mid * (1 + DEPTH_BAND);
    const buckets = new Map<number, number>();
    for (const side of sides) {
      for (const levels of [side.bids, side.asks]) {
        for (const [price, size] of levels) {
          if (!(size > 0) || price < lo || price > hi) continue;
          const index = Math.round(price / tick);
          buckets.set(index, (buckets.get(index) ?? 0) + size);
        }
      }
    }
    if (buckets.size === 0) return null;
    const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    const index = new Int32Array(sorted.length);
    const size = new Float32Array(sorted.length);
    sorted.forEach(([i, s], k) => {
      index[k] = i;
      size[k] = s;
    });
    return this.addSnapshot(time, index, size, tick);
  }

  /** Append prebuilt bucket arrays (used when replaying a recording). */
  addSnapshot(time: number, index: Int32Array, size: Float32Array, tick: number): DepthSnapshot | null {
    if (!(tick > 0) || !index.length) return null;
    if (tick !== this._tick) {
      this.clear();
      this._tick = tick;
    }
    const bucketTime = Math.floor(time / DEPTH_INTERVAL_MS) * DEPTH_INTERVAL_MS;
    const last = this.get(this.lastSeq);
    let snapshot: DepthSnapshot;
    if (last && last.time === bucketTime) {
      // Same second (e.g. replay catch-up): replace rather than duplicate.
      snapshot = { seq: last.seq, time: bucketTime, index, size };
    } else {
      snapshot = { seq: this.nextSeq++, time: bucketTime, index, size };
    }
    this.ring[snapshot.seq % this.capacity] = snapshot;
    this.version++;
    return snapshot;
  }

  get(seq: number): DepthSnapshot | undefined {
    if (seq < this.firstSeq || seq > this.lastSeq) return undefined;
    return this.ring[seq % this.capacity];
  }

  /** First sequence number whose snapshot time is ≥ `time` (lastSeq + 1 if none). */
  seqAtOrAfter(time: number): number {
    let lo = this.firstSeq;
    let hi = this.nextSeq;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.get(mid)!.time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** Size at the given percentile across a sample of snapshots (for colour scaling). */
export function depthPercentile(history: DepthHistory, fromSeq: number, toSeq: number, pct = 0.97, maxSamples = 240): number {
  const values: number[] = [];
  const span = Math.max(1, toSeq - fromSeq + 1);
  const step = Math.max(1, Math.floor(span / maxSamples));
  for (let seq = fromSeq; seq <= toSeq; seq += step) {
    const snap = history.get(seq);
    if (!snap) continue;
    for (let i = 0; i < snap.size.length; i++) values.push(snap.size[i]);
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(values.length * pct))];
}
