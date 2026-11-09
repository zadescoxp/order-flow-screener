import { AlertMonitor, DEFAULT_ALERT_SETTINGS, cvdDivergence, type AlertSettings, type AlertSnapshot } from "@/lib/engine/alerts";
import { createFlowBar } from "@/lib/engine/analytics";
import type { FlowBar, NormalizedLiquidation, NormalizedTrade } from "@/lib/types/market";

const allOn: AlertSettings = {
  ...DEFAULT_ALERT_SETTINGS,
  rules: Object.fromEntries(Object.keys(DEFAULT_ALERT_SETTINGS.rules).map((k) => [k, true])) as AlertSettings["rules"],
};

function snap(overrides: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    now: 1_000_000,
    price: 100,
    vwap: 99,
    vah: 105,
    val: 95,
    sessionTrades: 500,
    averagePrint: 1,
    volumeZ: null,
    stacked: null,
    divergence: null,
    newTrades: [],
    newLiquidations: [],
    newMicro: [],
    format: (p) => p.toFixed(1),
    ...overrides,
  };
}

const trade = (quantity: number, side: "buy" | "sell" = "buy"): NormalizedTrade => ({
  id: `t${quantity}`, venue: "bybit-futures", symbol: "BTCUSDT", timestamp: 1, localTimestamp: 1,
  price: 100, quantity, quoteVolume: quantity * 100, side, marketType: "perpetual",
});

describe("AlertMonitor", () => {
  it("fires a VWAP cross only on a side change, after warm-up, with cooldown", () => {
    const m = new AlertMonitor();
    expect(m.evaluate(snap({ price: 100 }), allOn)).toHaveLength(0); // establishes the side
    const crossed = m.evaluate(snap({ price: 98, now: 1_001_000 }), allOn);
    expect(crossed.map((e) => e.title)).toEqual(["Price crossed below VWAP"]);
    expect(crossed[0].tone).toBe("sell");
    // Back above within the cooldown: suppressed.
    expect(m.evaluate(snap({ price: 100, now: 1_002_000 }), allOn)).toHaveLength(0);
    // Below again after the cooldown: fires.
    expect(m.evaluate(snap({ price: 98, now: 1_040_000 }), allOn).map((e) => e.rule)).toEqual(["vwapCross"]);
  });

  it("does not fire crosses during warm-up or when the rule is off", () => {
    const cold = new AlertMonitor();
    cold.evaluate(snap({ sessionTrades: 10 }), allOn);
    expect(cold.evaluate(snap({ price: 98, sessionTrades: 10 }), allOn)).toHaveLength(0);

    const off = new AlertMonitor();
    const settings = { ...allOn, rules: { ...allOn.rules, vwapCross: false } };
    off.evaluate(snap(), settings);
    expect(off.evaluate(snap({ price: 98 }), settings)).toHaveLength(0);
  });

  it("fires value-area edge crosses for VAH and VAL", () => {
    const m = new AlertMonitor();
    m.evaluate(snap({ price: 100 }), allOn);
    expect(m.evaluate(snap({ price: 106 }), allOn).map((e) => e.title)).toEqual(["Price crossed above VAH"]);
  });

  it("fires a volume spike once per completed bar above the threshold", () => {
    const m = new AlertMonitor();
    expect(m.evaluate(snap({ volumeZ: { z: 3.5, time: 5000 } }), allOn).map((e) => e.rule)).toEqual(["volumeZ"]);
    expect(m.evaluate(snap({ volumeZ: { z: 3.5, time: 5000 }, now: 2_000_000 }), allOn)).toHaveLength(0);
    expect(m.evaluate(snap({ volumeZ: { z: 2.5, time: 10000 }, now: 3_000_000 }), allOn)).toHaveLength(0);
  });

  it("fires once per new stacked imbalance, not when an existing stack grows", () => {
    const m = new AlertMonitor();
    const runs = [{ dir: "buy" as const, start: 100, end: 102 }];
    expect(m.evaluate(snap({ stacked: { candleOpen: 0, runs } }), allOn).map((e) => e.rule)).toEqual(["stackedImbalance"]);
    const grown = [{ dir: "buy" as const, start: 99, end: 103 }];
    expect(m.evaluate(snap({ stacked: { candleOpen: 0, runs: grown } }), allOn)).toHaveLength(0);
    const another = [...grown, { dir: "sell" as const, start: 90, end: 92 }];
    expect(m.evaluate(snap({ stacked: { candleOpen: 0, runs: another } }), allOn).map((e) => e.title)).toEqual(["Stacked sell imbalance"]);
  });

  it("reports the largest block print and the largest qualifying liquidation", () => {
    const m = new AlertMonitor();
    const events = m.evaluate(
      snap({
        newTrades: [trade(5), trade(30, "sell"), trade(25)],
        newLiquidations: [
          { id: "a", venue: "okx-futures", symbol: "BTC", timestamp: 1, localTimestamp: 1, price: 100, quantity: 1000, quoteVolume: 100_000, side: "long" },
          { id: "b", venue: "okx-futures", symbol: "BTC", timestamp: 1, localTimestamp: 1, price: 100, quantity: 5000, quoteVolume: 500_000, side: "short" },
        ] as NormalizedLiquidation[],
      }),
      allOn
    );
    expect(events.map((e) => e.title)).toEqual(["Block sell 30× average", "Short liquidation $500.0K"]);
  });

  it("fires CVD divergence when entering the state", () => {
    const m = new AlertMonitor();
    expect(m.evaluate(snap({ divergence: "bullish" }), allOn).map((e) => e.title)).toEqual(["Bullish CVD divergence"]);
    expect(m.evaluate(snap({ divergence: "bullish", now: 2_000_000 }), allOn)).toHaveLength(0);
  });
});

describe("cvdDivergence", () => {
  const bars = (priceMove: number, cvdMove: number): FlowBar[] =>
    Array.from({ length: 61 }, (_, i) => ({
      ...createFlowBar(i * 1000, 100 + (priceMove * i) / 60, (cvdMove * i) / 60),
      volume: 1,
      close: 100 + (priceMove * i) / 60,
      cvd: (cvdMove * i) / 60,
    }));

  it("detects bullish and bearish divergence and ignores tiny moves", () => {
    expect(cvdDivergence(bars(-1, 20), 0.1)).toBe("bullish");
    expect(cvdDivergence(bars(1, -20), 0.1)).toBe("bearish");
    expect(cvdDivergence(bars(1, 20), 0.1)).toBeNull();
    expect(cvdDivergence(bars(0.1, -20), 0.1)).toBeNull(); // price moved < 2 ticks
    expect(cvdDivergence(bars(1, -1), 0.1)).toBeNull(); // CVD moved < 10% of volume
    expect(cvdDivergence(bars(1, -20).slice(0, 30), 0.1)).toBeNull();
  });
});
