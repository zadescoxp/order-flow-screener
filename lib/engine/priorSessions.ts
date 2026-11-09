// ============================================================
// PRIOR-SESSION LEVELS
// Previous UTC days' POC, value area, VWAP and range, built from
// exchange klines, and the POCs that price has not traded back to.
//
// Klines don't carry volume-at-price, so each bar's volume is spread
// evenly across the ticks between its low and high. VWAP is exact
// (quote volume ÷ base volume).
// ============================================================

export interface Kline {
  openTime: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base
  quoteVolume: number;
}

export interface DayLevels {
  day: number; // UTC midnight (ms)
  poc: number;
  vah: number;
  val: number;
  vwap: number;
  high: number;
  low: number;
  volume: number;
}

export const DAY_MS = 86_400_000;

export function utcDay(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

/** Parse Binance kline rows: [openTime, open, high, low, close, volume, closeTime, quoteVolume, …]. */
export function parseBinanceKlines(rows: unknown[][]): Kline[] {
  return rows
    .map((r) => ({
      openTime: Number(r[0]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      quoteVolume: Number(r[7]),
    }))
    .filter((k) => Number.isFinite(k.openTime) && k.high > 0 && k.low > 0 && k.volume >= 0);
}

/** Volume by tick index, spreading each bar's volume across its range. */
export function distributeVolume(klines: Kline[], tick: number): Map<number, number> {
  const profile = new Map<number, number>();
  for (const k of klines) {
    if (!(k.volume > 0)) continue;
    const lo = Math.round(k.low / tick);
    const hi = Math.round(k.high / tick);
    const share = k.volume / (hi - lo + 1);
    for (let i = lo; i <= hi; i++) profile.set(i, (profile.get(i) ?? 0) + share);
  }
  return profile;
}

/** POC and value area from a volume-by-tick map (expanding from the POC toward the larger neighbour). */
export function valueArea(profile: Map<number, number>, valueAreaPct: number): { poc: number; vah: number; val: number } | null {
  if (!profile.size) return null;
  const indices = [...profile.keys()].sort((a, b) => a - b);
  let total = 0;
  let pocAt = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = profile.get(indices[i])!;
    total += v;
    if (v > profile.get(indices[pocAt])!) pocAt = i;
  }
  let lo = pocAt;
  let hi = pocAt;
  let inside = profile.get(indices[pocAt])!;
  while (inside < total * valueAreaPct && (lo > 0 || hi < indices.length - 1)) {
    const below = lo > 0 ? profile.get(indices[lo - 1])! : -1;
    const above = hi < indices.length - 1 ? profile.get(indices[hi + 1])! : -1;
    if (above >= below) inside += profile.get(indices[++hi])!;
    else inside += profile.get(indices[--lo])!;
  }
  return { poc: indices[pocAt], vah: indices[hi], val: indices[lo] };
}

/** Levels for each complete UTC day in the klines, oldest first. `today` is excluded. */
export function dayLevels(klines: Kline[], tick: number, valueAreaPct: number, today: number): DayLevels[] {
  const byDay = new Map<number, Kline[]>();
  for (const k of klines) {
    const day = utcDay(k.openTime);
    if (day >= today) continue;
    let list = byDay.get(day);
    if (!list) byDay.set(day, (list = []));
    list.push(k);
  }
  const out: DayLevels[] = [];
  for (const [day, bars] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const va = valueArea(distributeVolume(bars, tick), valueAreaPct);
    if (!va) continue;
    let volume = 0;
    let quote = 0;
    let high = -Infinity;
    let low = Infinity;
    for (const b of bars) {
      volume += b.volume;
      quote += b.quoteVolume;
      high = Math.max(high, b.high);
      low = Math.min(low, b.low);
    }
    out.push({ day, poc: va.poc * tick, vah: va.vah * tick, val: va.val * tick, vwap: volume ? quote / volume : 0, high, low, volume });
  }
  return out;
}

/**
 * POCs not revisited since their day: every later day's range (and today's
 * range so far) lies entirely above or below the POC. Newest first.
 */
export function nakedPocs(days: DayLevels[], todayHigh: number, todayLow: number): DayLevels[] {
  const out: DayLevels[] = [];
  for (let i = 0; i < days.length; i++) {
    const { poc } = days[i];
    let touched = Number.isFinite(todayHigh) && Number.isFinite(todayLow) && todayLow <= poc && poc <= todayHigh;
    for (let j = i + 1; j < days.length && !touched; j++) touched = days[j].low <= poc && poc <= days[j].high;
    if (!touched) out.push(days[i]);
  }
  return out.reverse();
}
