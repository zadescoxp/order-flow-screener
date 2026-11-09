// ============================================================
// CROSS-VENUE ANALYTICS
// Per-venue 250 ms buckets of last price and aggressive volume, and a
// lead/lag estimate: which venue's price moves first.
// ============================================================

import type { NormalizedTrade, Venue } from "@/lib/types/market";

export const VENUE_BUCKET_MS = 250;
export const VENUE_BUCKETS = 720; // three minutes
const MIN_LEAD_BUCKETS = 120; // 30 s of shared history before estimating lead / lag

export interface VenueBucket {
  time: number;
  close: number;
  buy: number;
  sell: number;
  trades: number;
}

/** Ring of buckets per venue, keyed by exchange time. */
export class VenueTracker {
  private series = new Map<Venue, VenueBucket[]>();

  clear(): void {
    this.series.clear();
  }

  onTrade(trade: NormalizedTrade): void {
    const time = Math.floor(trade.timestamp / VENUE_BUCKET_MS) * VENUE_BUCKET_MS;
    let list = this.series.get(trade.venue);
    if (!list) {
      list = [];
      this.series.set(trade.venue, list);
    }
    let bucket = list[list.length - 1];
    if (!bucket || time > bucket.time) {
      bucket = { time, close: trade.price, buy: 0, sell: 0, trades: 0 };
      list.push(bucket);
      if (list.length > VENUE_BUCKETS) list.splice(0, list.length - VENUE_BUCKETS);
    } else if (time < bucket.time) {
      // Out-of-order print: credit volume to the latest bucket, keep its close.
    } else {
      bucket.close = trade.price;
    }
    if (trade.side === "buy") bucket.buy += trade.quantity;
    else bucket.sell += trade.quantity;
    bucket.trades++;
  }

  snapshot(): Partial<Record<Venue, VenueBucket[]>> {
    const out: Partial<Record<Venue, VenueBucket[]>> = {};
    for (const [venue, list] of this.series) out[venue] = list.map((b) => ({ ...b }));
    return out;
  }
}

export interface VenueStat {
  venue: Venue;
  last: number;
  /** Last price vs the median of all venues' last prices, in basis points. */
  premiumBps: number;
  volume: number; // base units over the window
  share: number; // of all venues' volume over the window
  delta: number; // buy − sell over the window
  /** Positive: this venue moves first by this many ms. Null when there isn't enough signal. */
  leadMs: number | null;
  /** Correlation at the chosen lag (how clear the relationship is). */
  leadCorr: number | null;
}

export interface VenueSummary {
  stats: VenueStat[];
  leader: VenueStat | null;
}

/** Forward-filled close prices on a common grid. */
function grid(list: VenueBucket[], from: number, count: number): Float64Array | null {
  const out = new Float64Array(count);
  let j = 0;
  let last = NaN;
  for (let i = 0; i < count; i++) {
    const t = from + i * VENUE_BUCKET_MS;
    while (j < list.length && list[j].time <= t) last = list[j++].close;
    out[i] = last;
  }
  // Need prices from the start of the grid.
  return Number.isFinite(out[0]) ? out : null;
}

function returns(prices: Float64Array): Float64Array {
  const r = new Float64Array(prices.length - 1);
  for (let i = 1; i < prices.length; i++) r[i - 1] = Math.log(prices[i] / prices[i - 1]);
  return r;
}

/** corr(a[t], b[t + lag]) over the overlapping range. */
export function laggedCorrelation(a: Float64Array, b: Float64Array, lag: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let t = Math.max(0, -lag); t < a.length && t + lag < b.length; t++) {
    const x = a[t];
    const y = b[t + lag];
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; n++;
  }
  if (n < 10) return 0;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Per-venue stats over the trailing `windowMs`, and lead/lag of each venue
 * against the average of the others over `leadWindowMs` (±`maxLag` buckets).
 */
export function venueSummary(
  series: Partial<Record<Venue, VenueBucket[]>>,
  now: number,
  windowMs = 60_000,
  leadWindowMs = 150_000,
  maxLag = 8,
  minCorr = 0.1
): VenueSummary {
  const venues = (Object.keys(series) as Venue[]).filter((v) => series[v]?.length);
  const lasts = venues.map((v) => series[v]![series[v]!.length - 1].close).sort((a, b) => a - b);
  const median = lasts.length ? lasts[Math.floor(lasts.length / 2)] : 0;
  const since = now - windowMs;

  let totalVolume = 0;
  const stats: VenueStat[] = venues.map((venue) => {
    const list = series[venue]!;
    let volume = 0;
    let delta = 0;
    for (let i = list.length - 1; i >= 0 && list[i].time >= since; i--) {
      volume += list[i].buy + list[i].sell;
      delta += list[i].buy - list[i].sell;
    }
    totalVolume += volume;
    const last = list[list.length - 1].close;
    return { venue, last, premiumBps: median ? ((last - median) / median) * 10_000 : 0, volume, share: 0, delta, leadMs: null, leadCorr: null };
  });
  for (const s of stats) s.share = totalVolume ? s.volume / totalVolume : 0;

  // Lead/lag over the history every venue shares: at least 30 s, at most `leadWindowMs`.
  const sharedStart = Math.max(now - leadWindowMs, ...venues.map((v) => series[v]![0].time));
  const from = Math.ceil(sharedStart / VENUE_BUCKET_MS) * VENUE_BUCKET_MS;
  const count = Math.floor((now - from) / VENUE_BUCKET_MS);
  if (venues.length >= 2 && count >= MIN_LEAD_BUCKETS) {
    const r = new Map<Venue, Float64Array>();
    for (const venue of venues) {
      const prices = grid(series[venue]!, from, count);
      if (prices) r.set(venue, returns(prices));
    }
    for (const stat of stats) {
      const own = r.get(stat.venue);
      const others = [...r.entries()].filter(([v]) => v !== stat.venue).map(([, x]) => x);
      if (!own || !others.length) continue;
      const ref = new Float64Array(own.length);
      for (const o of others) for (let i = 0; i < ref.length; i++) ref[i] += o[i] / others.length;
      let bestLag = 0;
      let best = laggedCorrelation(own, ref, 0);
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        if (lag === 0) continue;
        const c = laggedCorrelation(own, ref, lag);
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      if (best < minCorr) continue;
      // own[t] best matches ref[t + lag]: a positive lag means this venue moves first.
      stat.leadMs = bestLag * VENUE_BUCKET_MS;
      stat.leadCorr = best;
    }
  }

  stats.sort((a, b) => b.volume - a.volume);
  const leaders = stats.filter((s) => s.leadMs !== null && s.leadMs > 0).sort((a, b) => b.leadMs! - a.leadMs! || b.leadCorr! - a.leadCorr!);
  return { stats, leader: leaders[0] ?? null };
}
