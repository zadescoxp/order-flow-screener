// ============================================================
// UNIT TESTS — Order Flow Engine
// Tests: trade classification, delta, OBI, imbalance,
//        stacked imbalance, Z-score, volume profile
// ============================================================

import {
  applyTradeToCandle,
  createEmptyCandle,
  computeOBI,
  computeZScore,
  computeVolumeProfile,
  detectStackedImbalances,
  classifyTrade,
  roundToTick,
  getCandleOpenTime,
} from "../lib/engine/orderFlowEngine";
import type { NormalizedTrade, FootprintCandle } from "../lib/types/market";

// ─── Helper: create a test trade ─────────────────────────────
function makeTrade(
  price: number,
  qty: number,
  side: "buy" | "sell",
  timestamp = Date.now()
): NormalizedTrade {
  return {
    id: `test-${Math.random()}`,
    venue: "binance-futures",
    symbol: "BTCUSDT",
    timestamp,
    localTimestamp: timestamp,
    price,
    quantity: qty,
    quoteVolume: price * qty,
    side,
    marketType: "perpetual",
  };
}

// ─────────────────────────────────────────────────────────────
// 1. Trade Classification
// ─────────────────────────────────────────────────────────────
describe("Trade Classification (tick-rule)", () => {
  test("price up → buy", () => {
    expect(classifyTrade(100, 99, "sell")).toBe("buy");
  });
  test("price down → sell", () => {
    expect(classifyTrade(98, 99, "buy")).toBe("sell");
  });
  test("price unchanged → follows previous side", () => {
    expect(classifyTrade(100, 100, "buy")).toBe("buy");
    expect(classifyTrade(100, 100, "sell")).toBe("sell");
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Price Rounding
// ─────────────────────────────────────────────────────────────
describe("roundToTick", () => {
  test("rounds to nearest tick", () => {
    expect(roundToTick(63215, 10)).toBe(63220);
    expect(roundToTick(63214, 10)).toBe(63210);
    expect(roundToTick(63210, 10)).toBe(63210);
  });
  test("handles sub-dollar ticks", () => {
    expect(roundToTick(1.234, 0.01)).toBeCloseTo(1.23, 5);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Candle Open Time
// ─────────────────────────────────────────────────────────────
describe("getCandleOpenTime", () => {
  test("5m candle", () => {
    const t = new Date("2024-01-01T10:07:30Z").getTime();
    expect(getCandleOpenTime(t, "5m")).toBe(
      new Date("2024-01-01T10:05:00Z").getTime()
    );
  });
  test("1h candle", () => {
    const t = new Date("2024-01-01T10:47:00Z").getTime();
    expect(getCandleOpenTime(t, "1h")).toBe(
      new Date("2024-01-01T10:00:00Z").getTime()
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Delta Calculation
// ─────────────────────────────────────────────────────────────
describe("Delta (askVolume - bidVolume)", () => {
  let candle: FootprintCandle;

  beforeEach(() => {
    candle = createEmptyCandle(0, "5m");
  });

  test("buy trade increases ask volume and positive delta", () => {
    candle = applyTradeToCandle(candle, makeTrade(63000, 1.5, "buy"), 10, 3);
    const level = candle.levels.get(63000)!;
    expect(level.askVolume).toBeCloseTo(1.5);
    expect(level.bidVolume).toBe(0);
    expect(level.delta).toBeCloseTo(1.5);
    expect(candle.delta).toBeCloseTo(1.5);
  });

  test("sell trade increases bid volume and negative delta", () => {
    candle = applyTradeToCandle(candle, makeTrade(63000, 2.0, "sell"), 10, 3);
    const level = candle.levels.get(63000)!;
    expect(level.bidVolume).toBeCloseTo(2.0);
    expect(level.askVolume).toBe(0);
    expect(level.delta).toBeCloseTo(-2.0);
    expect(candle.delta).toBeCloseTo(-2.0);
  });

  test("mixed trades compute correct net delta", () => {
    candle = applyTradeToCandle(candle, makeTrade(63000, 3.0, "buy"), 10, 3);
    candle = applyTradeToCandle(candle, makeTrade(63000, 1.0, "sell"), 10, 3);
    // Level: ask=3, bid=1, delta=2
    const level = candle.levels.get(63000)!;
    expect(level.delta).toBeCloseTo(2.0);
    expect(candle.delta).toBeCloseTo(2.0);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. OBI
// ─────────────────────────────────────────────────────────────
describe("OBI (Order Book Imbalance)", () => {
  test("balanced book → 0", () => {
    expect(computeOBI(100, 100)).toBe(0);
  });
  test("all bids → +1", () => {
    expect(computeOBI(100, 0)).toBe(1);
  });
  test("all asks → -1", () => {
    expect(computeOBI(0, 100)).toBe(-1);
  });
  test("bid-heavy → positive", () => {
    const obi = computeOBI(75, 25);
    expect(obi).toBeCloseTo(0.5);
  });
  test("ask-heavy → negative", () => {
    const obi = computeOBI(25, 75);
    expect(obi).toBeCloseTo(-0.5);
  });
  test("zero total → 0 (no division by zero)", () => {
    expect(computeOBI(0, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Order Flow Imbalance (3x threshold)
// ─────────────────────────────────────────────────────────────
describe("Imbalance detection", () => {
  test("ask/bid >= 3 → ask imbalance", () => {
    let candle = createEmptyCandle(0, "5m");
    candle = applyTradeToCandle(candle, makeTrade(63000, 1.0, "sell"), 10, 3); // bid=1
    candle = applyTradeToCandle(candle, makeTrade(63000, 3.0, "buy"), 10, 3); // ask=3
    const level = candle.levels.get(63000)!;
    expect(level.imbalance).toBe("ask");
  });

  test("bid/ask >= 3 → bid imbalance", () => {
    let candle = createEmptyCandle(0, "5m");
    candle = applyTradeToCandle(candle, makeTrade(63000, 3.0, "sell"), 10, 3); // bid=3
    candle = applyTradeToCandle(candle, makeTrade(63000, 1.0, "buy"), 10, 3); // ask=1
    const level = candle.levels.get(63000)!;
    expect(level.imbalance).toBe("bid");
  });

  test("ratio < 3 → neutral", () => {
    let candle = createEmptyCandle(0, "5m");
    candle = applyTradeToCandle(candle, makeTrade(63000, 2.0, "sell"), 10, 3); // bid=2
    candle = applyTradeToCandle(candle, makeTrade(63000, 2.0, "buy"), 10, 3); // ask=2
    const level = candle.levels.get(63000)!;
    expect(level.imbalance).toBe("neutral");
  });

  test("custom threshold (2x)", () => {
    let candle = createEmptyCandle(0, "5m");
    candle = applyTradeToCandle(candle, makeTrade(63000, 1.0, "sell"), 10, 2); // bid=1
    candle = applyTradeToCandle(candle, makeTrade(63000, 2.1, "buy"), 10, 2); // ask=2.1
    const level = candle.levels.get(63000)!;
    expect(level.imbalance).toBe("ask"); // 2.1/1 >= 2
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Stacked Imbalance
// ─────────────────────────────────────────────────────────────
describe("Stacked Imbalance", () => {
  function makeImbCandle(imbalances: Array<{ price: number; dir: "ask" | "bid" | "neutral" }>): FootprintCandle {
    let candle = createEmptyCandle(0, "5m");
    for (const { price, dir } of imbalances) {
      if (dir === "ask") {
        candle = applyTradeToCandle(candle, makeTrade(price, 0.1, "sell"), 10, 3);
        candle = applyTradeToCandle(candle, makeTrade(price, 0.31, "buy"), 10, 3);
      } else if (dir === "bid") {
        candle = applyTradeToCandle(candle, makeTrade(price, 0.31, "sell"), 10, 3);
        candle = applyTradeToCandle(candle, makeTrade(price, 0.1, "buy"), 10, 3);
      } else {
        candle = applyTradeToCandle(candle, makeTrade(price, 1.0, "sell"), 10, 3);
        candle = applyTradeToCandle(candle, makeTrade(price, 1.2, "buy"), 10, 3);
      }
    }
    return candle;
  }

  test("detects 3 consecutive ask imbalances", () => {
    const candle = makeImbCandle([
      { price: 63020, dir: "ask" },
      { price: 63010, dir: "ask" },
      { price: 63000, dir: "ask" },
    ]);
    const stacked = detectStackedImbalances(candle, 3);
    expect(stacked.length).toBeGreaterThanOrEqual(1);
    expect(stacked[0].direction).toBe("buy");
    expect(stacked[0].levels).toBe(3);
  });

  test("does not detect when fewer than min levels", () => {
    const candle = makeImbCandle([
      { price: 63010, dir: "ask" },
      { price: 63000, dir: "ask" },
    ]);
    const stacked = detectStackedImbalances(candle, 3);
    expect(stacked.length).toBe(0);
  });

  test("detects bid imbalance stack", () => {
    const candle = makeImbCandle([
      { price: 63030, dir: "bid" },
      { price: 63020, dir: "bid" },
      { price: 63010, dir: "bid" },
      { price: 63000, dir: "bid" },
    ]);
    const stacked = detectStackedImbalances(candle, 3);
    expect(stacked.some((s) => s.direction === "sell" && s.levels >= 3)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. Z-Score
// ─────────────────────────────────────────────────────────────
describe("Z-Score", () => {
  const window = [1, 2, 3, 4, 5];
  test("value at mean → z=0", () => {
    const z = computeZScore(window, 3);
    expect(z).toBeCloseTo(0, 1);
  });
  test("value above mean → positive z", () => {
    const z = computeZScore(window, 7);
    expect(z).toBeGreaterThan(0);
  });
  test("value below mean → negative z", () => {
    const z = computeZScore(window, 1);
    expect(z).toBeLessThan(0);
  });
  test("empty window → 0", () => {
    expect(computeZScore([], 5)).toBe(0);
    expect(computeZScore([5], 5)).toBe(0);
  });
  test("all same values → 0", () => {
    expect(computeZScore([5, 5, 5, 5, 5], 5)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. Volume Profile
// ─────────────────────────────────────────────────────────────
describe("Volume Profile", () => {
  function makeTestCandle(
    levels: Array<{ price: number; buy: number; sell: number }>
  ): FootprintCandle {
    let candle = createEmptyCandle(0, "5m");
    for (const { price, buy, sell } of levels) {
      if (buy > 0) candle = applyTradeToCandle(candle, makeTrade(price, buy, "buy"), 10, 3);
      if (sell > 0) candle = applyTradeToCandle(candle, makeTrade(price, sell, "sell"), 10, 3);
    }
    return candle;
  }

  test("identifies POC as highest volume level", () => {
    const candle = makeTestCandle([
      { price: 63000, buy: 1, sell: 1 },
      { price: 63010, buy: 5, sell: 5 }, // highest
      { price: 63020, buy: 2, sell: 2 },
    ]);
    const vp = computeVolumeProfile([candle]);
    expect(vp.poc).toBe(63010);
  });

  test("total volume sums correctly", () => {
    const candle = makeTestCandle([
      { price: 63000, buy: 2, sell: 3 },
      { price: 63010, buy: 1, sell: 1 },
    ]);
    const vp = computeVolumeProfile([candle]);
    expect(vp.totalVolume).toBeCloseTo(7);
  });

  test("VAH >= POC >= VAL", () => {
    const candle = makeTestCandle([
      { price: 63000, buy: 1, sell: 1 },
      { price: 63010, buy: 5, sell: 5 },
      { price: 63020, buy: 2, sell: 2 },
      { price: 63030, buy: 1, sell: 1 },
    ]);
    const vp = computeVolumeProfile([candle]);
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc);
    expect(vp.poc).toBeGreaterThanOrEqual(vp.val);
  });

  test("delta = buyVolume - sellVolume", () => {
    const candle = makeTestCandle([
      { price: 63000, buy: 5, sell: 3 },
    ]);
    const vp = computeVolumeProfile([candle]);
    expect(vp.delta).toBeCloseTo(vp.buyVolume - vp.sellVolume);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. Price-Level Aggregation across multiple candles
// ─────────────────────────────────────────────────────────────
describe("Price-level aggregation", () => {
  test("merges same price from multiple candles", () => {
    let c1 = createEmptyCandle(0, "5m");
    let c2 = createEmptyCandle(300_000, "5m");

    c1 = applyTradeToCandle(c1, makeTrade(63000, 2.0, "buy"), 10, 3);
    c2 = applyTradeToCandle(c2, makeTrade(63000, 3.0, "buy"), 10, 3);

    const vp = computeVolumeProfile([c1, c2]);
    const level = vp.levels.find((l) => l.price === 63000);
    expect(level).toBeDefined();
    expect(level!.askVolume).toBeCloseTo(5.0);
  });
});
