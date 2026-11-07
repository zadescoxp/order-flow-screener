import {
  applyTradeToSession,
  averageTrueRange,
  createFlowBar,
  createSessionStats,
  parkinsonVolatility,
  percentileRank,
  resampleBars,
  resolveTickSize,
  rollingRealizedVolatility,
  rollingVolumeZScores,
} from "@/lib/engine/analytics";
import { createEmptyCandle } from "@/lib/engine/orderFlowEngine";
import type { FlowBar } from "@/lib/types/market";

function bar(time: number, close: number, volume: number, buyShare = 0.5): FlowBar {
  return {
    ...createFlowBar(time, close, 0),
    volume,
    buyVolume: volume * buyShare,
    sellVolume: volume * (1 - buyShare),
    trades: volume > 0 ? 1 : 0,
  };
}

describe("rollingVolumeZScores", () => {
  it("scores each bar against the preceding window only", () => {
    // 10 bars alternating 9/11 (mean 10, sample std ≈ 1.054), then a spike of 20.
    const bars = Array.from({ length: 10 }, (_, i) => bar(i * 1000, 100, i % 2 ? 11 : 9));
    bars.push(bar(10_000, 100, 20));
    const z = rollingVolumeZScores(bars, 10);
    const last = z[z.length - 1];
    expect(last.mean).toBeCloseTo(10);
    expect(last.std).toBeCloseTo(Math.sqrt(10 / 9), 6);
    expect(last.z).toBeCloseTo(10 / Math.sqrt(10 / 9), 6);
  });

  it("returns null until enough history exists", () => {
    const bars = Array.from({ length: 5 }, (_, i) => bar(i * 1000, 100, 1 + i));
    const z = rollingVolumeZScores(bars, 20, 10);
    expect(z.every((point) => point.z === null)).toBe(true);
  });

  it("returns 0 for a flat baseline", () => {
    const bars = Array.from({ length: 12 }, (_, i) => bar(i * 1000, 100, 5));
    expect(rollingVolumeZScores(bars, 10).at(-1)?.z).toBe(0);
  });

  it("measures volume, not price movement", () => {
    // Large price moves on constant volume must not register as a z-score spike.
    const bars = Array.from({ length: 15 }, (_, i) => bar(i * 1000, 100 + (i % 2 ? 50 : -50), 5));
    expect(rollingVolumeZScores(bars, 10).at(-1)?.z).toBe(0);
  });
});

describe("rollingRealizedVolatility", () => {
  it("is zero when price does not move", () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i * 1000, 100, 5));
    expect(rollingRealizedVolatility(bars, 20, 1, 365 * 86400).at(-1)?.value).toBe(0);
  });

  it("annualizes the RMS log return", () => {
    // Alternating ±1% moves: every |log return| is ln(1.01) or ln(1/1.01).
    const closes = Array.from({ length: 41 }, (_, i) => (i % 2 ? 101 : 100));
    const bars = closes.map((close, i) => bar(i * 60_000, close, 1));
    const yearSeconds = 365 * 86400;
    const rv = rollingRealizedVolatility(bars, 20, 60, yearSeconds).at(-1)?.value ?? 0;
    const expected = Math.log(1.01) * Math.sqrt(yearSeconds / 60) * 100;
    expect(rv).toBeCloseTo(expected, 6);
  });

  it("does not react to volume", () => {
    const quiet = Array.from({ length: 30 }, (_, i) => bar(i * 1000, 100 + (i % 3), 1));
    const loud = quiet.map((b, i) => ({ ...b, volume: i === 29 ? 10_000 : b.volume }));
    const a = rollingRealizedVolatility(quiet, 20, 1, 1e6).at(-1)?.value;
    const b = rollingRealizedVolatility(loud, 20, 1, 1e6).at(-1)?.value;
    expect(a).toBe(b);
  });
});

describe("resampleBars", () => {
  it("merges 1-second bars into larger buckets", () => {
    const bars = [bar(0, 100, 1), bar(1000, 105, 2), bar(5000, 95, 3)];
    bars[1].high = 106;
    bars[2].low = 94;
    const out = resampleBars(bars, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 0, open: 100, close: 105, high: 106, volume: 3 });
    expect(out[1]).toMatchObject({ time: 5000, close: 95, low: 94, volume: 3 });
  });
});

describe("candle volatility", () => {
  function candle(high: number, low: number, close: number) {
    const c = createEmptyCandle(0, "1m");
    c.open = close;
    c.high = high;
    c.low = low;
    c.close = close;
    return c;
  }

  it("computes ATR including gaps", () => {
    const candles = [candle(10, 8, 9), candle(14, 12, 13)];
    // TR2 = max(2, |14-9|, |12-9|) = 5 → mean of (2, 5)
    expect(averageTrueRange(candles, 14)).toBeCloseTo(3.5);
  });

  it("computes Parkinson volatility from high/low ranges", () => {
    const candles = [candle(101, 100, 100), candle(101, 100, 100)];
    const value = parkinsonVolatility(candles, 60, 60 * 4 * Math.LN2) ?? 0;
    expect(value).toBeCloseTo(Math.log(1.01) * 100, 6);
  });
});

describe("session VWAP", () => {
  it("tracks VWAP and its volume-weighted deviation", () => {
    const stats = createSessionStats(0, 100);
    applyTradeToSession(stats, 100, 1, "buy", 0);
    applyTradeToSession(stats, 110, 1, "sell", 0);
    expect(stats.vwap).toBeCloseTo(105);
    expect(stats.vwapStd).toBeCloseTo(5);
    expect(stats.buyVolume).toBe(1);
    expect(stats.sellVolume).toBe(1);
    expect(stats.high).toBe(110);
  });
});

describe("resolveTickSize", () => {
  it("scales footprint rows to the instrument price", () => {
    expect(resolveTickSize(100_000, "perpetual")).toBe(10);
    expect(resolveTickSize(3_500, "perpetual")).toBe(0.5);
    expect(resolveTickSize(150, "spot")).toBe(0.02);
    expect(resolveTickSize(1.08, "forex")).toBe(0.0001);
    expect(resolveTickSize(150, "forex")).toBe(0.01);
  });
});

describe("percentileRank", () => {
  it("ranks a value within a sample", () => {
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(87.5);
    expect(percentileRank([], 1)).toBe(50);
  });
});
