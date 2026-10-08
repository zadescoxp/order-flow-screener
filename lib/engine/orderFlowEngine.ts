// ============================================================
// ORDER FLOW ENGINE
// Aggregates normalized trades into footprint candles
// ============================================================

import type {
  NormalizedTrade,
  FootprintCandle,
  FootprintLevel,
  Timeframe,
  StackedImbalance,
  AbsorptionEvent,
  DeltaDivergence,
} from "@/lib/types/market";

// ----------------------------------------------------------
// Config
// ----------------------------------------------------------
export interface OrderFlowConfig {
  timeframe: Timeframe;
  tickSize: number; // price rounding granularity
  imbalanceThreshold: number; // default 3x
  stackedImbalanceLevels: number; // default 3
  zScoreWindow: number; // default 20
  absorptionVolumeThreshold: number; // min volume to flag
  absorptionPriceThreshold: number; // max price movement to flag absorption
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
export function getCandleOpenTime(timestamp: number, timeframe: Timeframe): number {
  const ms = TIMEFRAME_MS[timeframe];
  return Math.floor(timestamp / ms) * ms;
}

export function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

// ----------------------------------------------------------
// Create an empty candle
// ----------------------------------------------------------
export function createEmptyCandle(
  openTime: number,
  timeframe: Timeframe
): FootprintCandle {
  const ms = TIMEFRAME_MS[timeframe];
  return {
    openTime,
    closeTime: openTime + ms - 1,
    open: 0,
    high: -Infinity,
    low: Infinity,
    close: 0,
    volume: 0,
    delta: 0,
    cumulativeDelta: 0,
    levels: new Map(),
    sortedPrices: [],
    tradeCount: 0,
    maxVolumeAtLevel: 0,
    complete: false,
  };
}

// ----------------------------------------------------------
// Apply a trade to a candle
// ----------------------------------------------------------
export function applyTradeToCandle(
  candle: FootprintCandle,
  trade: NormalizedTrade,
  tickSize: number,
  imbalanceThreshold: number
): FootprintCandle {
  const roundedPrice = roundToTick(trade.price, tickSize);

  // Update OHLC
  if (candle.open === 0) candle.open = trade.price;
  candle.close = trade.price;
  if (trade.price > candle.high) candle.high = trade.price;
  if (trade.price < candle.low) candle.low = trade.price;

  // Get or create level
  let level = candle.levels.get(roundedPrice);
  if (!level) {
    level = {
      price: roundedPrice,
      bidVolume: 0,
      askVolume: 0,
      totalVolume: 0,
      delta: 0,
      tradeCount: 0,
      buyTrades: 0,
      sellTrades: 0,
      maxTradeSize: 0,
      imbalance: "neutral",
      isHighVolume: false,
      zScore: 0,
    };
    candle.levels.set(roundedPrice, level);
    // Insert price in sorted order
    insertSorted(candle.sortedPrices, roundedPrice);
  }

  // Apply volume
  if (trade.side === "buy") {
    level.askVolume += trade.quantity;
    level.buyTrades += 1;
  } else {
    level.bidVolume += trade.quantity;
    level.sellTrades += 1;
  }

  level.totalVolume += trade.quantity;
  level.delta = level.askVolume - level.bidVolume;
  level.tradeCount += 1;
  if (trade.quantity > level.maxTradeSize) level.maxTradeSize = trade.quantity;

  // Imbalance flag
  if (level.bidVolume > 0 && level.askVolume / level.bidVolume >= imbalanceThreshold) {
    level.imbalance = "ask";
  } else if (level.askVolume > 0 && level.bidVolume / level.askVolume >= imbalanceThreshold) {
    level.imbalance = "bid";
  } else {
    level.imbalance = "neutral";
  }

  // Update candle totals
  candle.volume += trade.quantity;
  candle.tradeCount += 1;
  if (trade.side === "buy") {
    candle.delta += trade.quantity;
  } else {
    candle.delta -= trade.quantity;
  }

  if (level.totalVolume > candle.maxVolumeAtLevel) {
    candle.maxVolumeAtLevel = level.totalVolume;
  }

  return candle;
}

// ----------------------------------------------------------
// Apply Z-Score to all levels in a candle
// ----------------------------------------------------------
export function applyZScores(
  candle: FootprintCandle,
  allLevels: FootprintLevel[]
): void {
  if (allLevels.length < 2) return;

  const volumes = allLevels.map((l) => l.totalVolume);
  const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const variance = volumes.reduce((a, b) => a + (b - mean) ** 2, 0) / volumes.length;
  const std = Math.sqrt(variance);

  if (std === 0) return;

  for (const level of candle.levels.values()) {
    level.zScore = (level.totalVolume - mean) / std;
    level.isHighVolume = level.zScore >= 2;
  }
}

// ----------------------------------------------------------
// Detect stacked imbalances
// ----------------------------------------------------------
export function detectStackedImbalances(
  candle: FootprintCandle,
  minLevels: number
): StackedImbalance[] {
  const results: StackedImbalance[] = [];
  const prices = [...candle.sortedPrices]; // ascending

  let runDir: "buy" | "sell" | null = null;
  let runStart = 0;
  let runCount = 0;

  for (let i = 0; i < prices.length; i++) {
    const level = candle.levels.get(prices[i]);
    if (!level || level.imbalance === "neutral") {
      if (runCount >= minLevels && runDir) {
        results.push({
          direction: runDir,
          startPrice: prices[runStart],
          endPrice: prices[i - 1],
          levels: runCount,
          candle,
        });
      }
      runDir = null;
      runCount = 0;
      continue;
    }

    const dir = level.imbalance === "ask" ? "buy" : "sell";
    if (dir === runDir) {
      runCount++;
    } else {
      if (runCount >= minLevels && runDir) {
        results.push({
          direction: runDir,
          startPrice: prices[runStart],
          endPrice: prices[i - 1],
          levels: runCount,
          candle,
        });
      }
      runDir = dir;
      runStart = i;
      runCount = 1;
    }
  }

  if (runCount >= minLevels && runDir) {
    results.push({
      direction: runDir,
      startPrice: prices[runStart],
      endPrice: prices[prices.length - 1],
      levels: runCount,
      candle,
    });
  }

  return results;
}

// ----------------------------------------------------------
// Detect delta divergence
// ----------------------------------------------------------
export function detectDeltaDivergence(
  candles: FootprintCandle[]
): DeltaDivergence[] {
  const result: DeltaDivergence[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (curr.close > prev.close && curr.delta < prev.delta) {
      result.push({
        type: "price-up-delta-down",
        candleIndex: i,
        price: curr.close,
        delta: curr.delta,
      });
    } else if (curr.close < prev.close && curr.delta > prev.delta) {
      result.push({
        type: "price-down-delta-up",
        candleIndex: i,
        price: curr.close,
        delta: curr.delta,
      });
    }
  }
  return result;
}

// ----------------------------------------------------------
// Detect potential absorption
// ----------------------------------------------------------
export function detectAbsorption(
  candle: FootprintCandle,
  volumeThreshold: number,
  priceThreshold: number
): AbsorptionEvent[] {
  const events: AbsorptionEvent[] = [];
  const priceMove = Math.abs(candle.high - candle.low);

  for (const level of candle.levels.values()) {
    if (level.totalVolume >= volumeThreshold && priceMove <= priceThreshold) {
      events.push({
        timestamp: candle.openTime,
        price: level.price,
        side: level.askVolume > level.bidVolume ? "buy" : "sell",
        aggressiveVolume: level.totalVolume,
        priceMovement: priceMove,
      });
    }
  }

  return events;
}

// ----------------------------------------------------------
// Compute volume profile from a set of candles
// ----------------------------------------------------------
export function computeVolumeProfile(
  candles: FootprintCandle[],
  valueAreaPct = 0.7
) {
  const map = new Map<number, { bid: number; ask: number; trades: number }>();

  for (const candle of candles) {
    for (const [price, level] of candle.levels) {
      const existing = map.get(price) ?? { bid: 0, ask: 0, trades: 0 };
      existing.bid += level.bidVolume;
      existing.ask += level.askVolume;
      existing.trades += level.tradeCount;
      map.set(price, existing);
    }
  }

  const prices = [...map.keys()].sort((a, b) => a - b);
  const totalVol = prices.reduce((s, p) => s + (map.get(p)?.bid ?? 0) + (map.get(p)?.ask ?? 0), 0);

  // POC
  let pocPrice = prices[0] ?? 0;
  let pocVol = 0;
  for (const p of prices) {
    const d = map.get(p)!;
    const v = d.bid + d.ask;
    if (v > pocVol) {
      pocVol = v;
      pocPrice = p;
    }
  }

  // Value area: 70% of total volume around POC
  const target = totalVol * valueAreaPct;
  let vah = pocPrice;
  let val = pocPrice;
  let accumulated = pocVol;
  let hi = prices.indexOf(pocPrice);
  let lo = hi;

  while (accumulated < target && (hi < prices.length - 1 || lo > 0)) {
    const nextHiVol = hi < prices.length - 1
      ? ((d => d.bid + d.ask)(map.get(prices[hi + 1])!)) : 0;
    const nextLoVol = lo > 0
      ? ((d => d.bid + d.ask)(map.get(prices[lo - 1])!)) : 0;

    if (nextHiVol >= nextLoVol && hi < prices.length - 1) {
      hi++;
      vah = prices[hi];
      accumulated += nextHiVol;
    } else if (lo > 0) {
      lo--;
      val = prices[lo];
      accumulated += nextLoVol;
    } else {
      break;
    }
  }

  const levels = prices.map((price) => {
    const d = map.get(price)!;
    const tv = d.bid + d.ask;
    return {
      price,
      totalVolume: tv,
      bidVolume: d.bid,
      askVolume: d.ask,
      delta: d.ask - d.bid,
      tradeCount: d.trades,
      isPOC: price === pocPrice,
      isVAH: price === vah,
      isVAL: price === val,
    };
  });

  const buyVolume = levels.reduce((s, l) => s + l.askVolume, 0);
  const sellVolume = levels.reduce((s, l) => s + l.bidVolume, 0);

  return {
    levels,
    poc: pocPrice,
    vah,
    val,
    totalVolume: totalVol,
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
  };
}

// ----------------------------------------------------------
// Compute OBI
// ----------------------------------------------------------
export function computeOBI(bidVolume: number, askVolume: number): number {
  const total = bidVolume + askVolume;
  if (total === 0) return 0;
  return (bidVolume - askVolume) / total;
}

// ----------------------------------------------------------
// Rolling Z-Score
// ----------------------------------------------------------
export function computeZScore(window: number[], value: number): number {
  if (window.length < 2) return 0;
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (value - mean) / std;
}

// ----------------------------------------------------------
// Internal: insert into sorted array (ascending)
// ----------------------------------------------------------
function insertSorted(arr: number[], val: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  if (arr[lo] !== val) arr.splice(lo, 0, val);
}

// ----------------------------------------------------------
// Trade classifier (tick-rule fallback)
// ----------------------------------------------------------
export function classifyTrade(
  price: number,
  prevPrice: number,
  prevSide: "buy" | "sell"
): "buy" | "sell" {
  if (price > prevPrice) return "buy";
  if (price < prevPrice) return "sell";
  return prevSide;
}
