// ============================================================
// MARKET ANALYTICS
// Time-bucketed statistics derived from 1-second flow bars and
// footprint candles: volume z-score, realized volatility, ATR,
// Parkinson volatility and session VWAP.
// ============================================================

import type { FlowBar, FootprintCandle, MarketType, SessionStats } from "@/lib/types/market";

export const SECONDS_PER_YEAR: Record<"crypto" | "forex", number> = {
  // Crypto trades 24/7.
  crypto: 365 * 86_400,
  // Spot FX trades ~24h × 5 days × 52 weeks.
  forex: 260 * 86_400,
};

export function secondsPerYear(marketType: MarketType): number {
  return marketType === "forex" ? SECONDS_PER_YEAR.forex : SECONDS_PER_YEAR.crypto;
}

// ----------------------------------------------------------
// Flow bars
// ----------------------------------------------------------
export function createFlowBar(time: number, price: number, cvd: number): FlowBar {
  return {
    time,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    trades: 0,
    cvd,
  };
}

/** Combine 1-second bars into bars of `seconds` length. Input must be time-ascending. */
export function resampleBars(bars: FlowBar[], seconds: number): FlowBar[] {
  if (seconds <= 1) return bars;
  const bucketMs = seconds * 1000;
  const out: FlowBar[] = [];
  let current: FlowBar | null = null;
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / bucketMs) * bucketMs;
    if (!current || current.time !== bucket) {
      if (current) out.push(current);
      current = { ...bar, time: bucket };
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
    current.buyVolume += bar.buyVolume;
    current.sellVolume += bar.sellVolume;
    current.trades += bar.trades;
    current.cvd = bar.cvd;
  }
  if (current) out.push(current);
  return out;
}

// ----------------------------------------------------------
// Volume Z-Score
// z_t = (V_t − mean(V_{t−N..t−1})) / std(V_{t−N..t−1})
// The current bar is compared to the *preceding* window, so a
// spike cannot dilute its own baseline.
// ----------------------------------------------------------
export interface VolumeZPoint {
  time: number;
  z: number | null;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  mean: number | null;
  std: number | null;
}

export function rollingVolumeZScores(
  bars: FlowBar[],
  window: number,
  minSamples = Math.min(window, 10)
): VolumeZPoint[] {
  const out: VolumeZPoint[] = new Array(bars.length);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < bars.length; i++) {
    const n = Math.min(i, window);
    let mean: number | null = null;
    let std: number | null = null;
    let z: number | null = null;
    if (n >= Math.max(2, minSamples)) {
      mean = sum / n;
      const variance = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
      std = Math.sqrt(variance);
      z = std > 0 ? (bars[i].volume - mean) / std : 0;
    }
    out[i] = {
      time: bars[i].time,
      z,
      volume: bars[i].volume,
      buyVolume: bars[i].buyVolume,
      sellVolume: bars[i].sellVolume,
      mean,
      std,
    };
    // Slide the window forward to include bar i for the next step.
    sum += bars[i].volume;
    sumSq += bars[i].volume ** 2;
    if (i - window >= 0) {
      sum -= bars[i - window].volume;
      sumSq -= bars[i - window].volume ** 2;
    }
  }
  return out;
}

// ----------------------------------------------------------
// Realized volatility (close-to-close log returns)
// RV = sqrt(mean(r²)) × sqrt(periods per year), in percent.
// ----------------------------------------------------------
export interface VolatilityPoint {
  time: number;
  value: number | null; // annualized %, null until enough samples
}

export function rollingRealizedVolatility(
  bars: FlowBar[],
  window: number,
  barSeconds: number,
  yearSeconds: number,
  minSamples = Math.min(window, 10)
): VolatilityPoint[] {
  const annualize = Math.sqrt(yearSeconds / barSeconds);
  const returns: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    returns[i] = prev > 0 && curr > 0 ? Math.log(curr / prev) : 0;
  }
  const out: VolatilityPoint[] = new Array(bars.length);
  let sumSq = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= 1) sumSq += returns[i] ** 2;
    if (i - window >= 1) sumSq -= returns[i - window] ** 2;
    const n = Math.min(i, window);
    out[i] = {
      time: bars[i].time,
      value: n >= Math.max(2, minSamples) ? Math.sqrt(Math.max(0, sumSq) / n) * annualize * 100 : null,
    };
  }
  return out;
}

// ----------------------------------------------------------
// Candle-based volatility
// ----------------------------------------------------------
/** Average True Range with Wilder smoothing. Returns null when there are not enough candles. */
export function averageTrueRange(candles: FootprintCandle[], period = 14): number | null {
  const valid = candles.filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low);
  if (valid.length === 0) return null;
  const trueRanges = valid.map((candle, i) => {
    if (i === 0) return candle.high - candle.low;
    const prevClose = valid[i - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    );
  });
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/** Parkinson (high-low) volatility estimator, annualized %. */
export function parkinsonVolatility(
  candles: FootprintCandle[],
  candleSeconds: number,
  yearSeconds: number
): number | null {
  const ranges = candles
    .filter((c) => c.low > 0 && Number.isFinite(c.high) && c.high >= c.low)
    .map((c) => Math.log(c.high / c.low) ** 2);
  if (ranges.length < 2) return null;
  const variance = ranges.reduce((a, b) => a + b, 0) / (4 * Math.LN2 * ranges.length);
  return Math.sqrt(variance) * Math.sqrt(yearSeconds / candleSeconds) * 100;
}

/** Percentile rank (0–100) of `value` within `values`. */
export function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal * 0.5) / values.length) * 100;
}

// ----------------------------------------------------------
// Session stats / VWAP
// ----------------------------------------------------------
export function createSessionStats(startTime: number, price: number): SessionStats {
  return {
    startTime,
    open: price,
    high: price,
    low: price,
    last: price,
    volume: 0,
    notional: 0,
    buyVolume: 0,
    sellVolume: 0,
    trades: 0,
    maxTrade: 0,
    vwap: price,
    vwapStd: 0,
    sumPQ: 0,
    sumP2Q: 0,
    lastTradeLagMs: 0,
  };
}

export function applyTradeToSession(
  stats: SessionStats,
  price: number,
  quantity: number,
  side: "buy" | "sell",
  lagMs: number
): void {
  stats.last = price;
  if (price > stats.high) stats.high = price;
  if (price < stats.low) stats.low = price;
  stats.volume += quantity;
  stats.notional += price * quantity;
  if (side === "buy") stats.buyVolume += quantity;
  else stats.sellVolume += quantity;
  stats.trades += 1;
  if (quantity > stats.maxTrade) stats.maxTrade = quantity;
  stats.sumPQ += price * quantity;
  stats.sumP2Q += price * price * quantity;
  if (stats.volume > 0) {
    stats.vwap = stats.sumPQ / stats.volume;
    const variance = stats.sumP2Q / stats.volume - stats.vwap * stats.vwap;
    stats.vwapStd = Math.sqrt(Math.max(0, variance));
  }
  stats.lastTradeLagMs = lagMs;
}

// ----------------------------------------------------------
// Instrument tick size
// ----------------------------------------------------------
/**
 * Footprint row size targeting ~1 basis point of price for crypto and
 * ~0.5 bp (≈1 pip on majors) for FX, rounded to a 1/2/2.5/5 × 10ⁿ step.
 */
export function resolveTickSize(price: number, marketType: MarketType): number {
  if (!Number.isFinite(price) || price <= 0) return 1;
  const raw = price * (marketType === "forex" ? 0.00005 : 0.0001);
  const exponent = Math.floor(Math.log10(raw));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return Number((nice * magnitude).toPrecision(6));
}
