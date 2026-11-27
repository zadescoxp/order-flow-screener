import {
  buildFlowFrame,
  buildFundingFrame,
  buildLiquidationFrame,
  buildLiquidityFrame,
  ColumnRing,
  LEVERAGE_TIERS,
  LIQUIDITY_HALF,
  liquidationPrices,
  niceBinSize,
  SurfaceEngine,
  type SurfaceSampleInput,
} from "@/lib/engine/surfaces";
import type { DerivativesSnapshot } from "@/lib/types/market";

const T0 = 1_700_000_000_000;

function input(partial: Partial<SurfaceSampleInput> = {}): SurfaceSampleInput {
  return { sides: [], mid: 0, derivatives: [], openInterest: null, lastPrice: 100, ...partial };
}

describe("surface helpers", () => {
  it("picks round bins about 5 bps of the price", () => {
    expect(niceBinSize(90_000)).toBe(50);
    expect(niceBinSize(3_000)).toBe(2); // 1.5 rounds up
    expect(niceBinSize(100)).toBeCloseTo(0.05);
  });

  it("places liquidation prices inside 1/leverage of the entry", () => {
    const { long, short } = liquidationPrices(100, 10, 0.004);
    expect(long).toBeCloseTo(90.4);
    expect(short).toBeCloseTo(109.6);
  });

  it("keeps the newest columns and replaces a repeated second", () => {
    const ring = new ColumnRing<{ time: number; v: number }>(3);
    for (let i = 0; i < 5; i++) ring.push({ time: i, v: i });
    ring.push({ time: 4, v: 40 });
    expect(ring.toArray().map((c) => c.v)).toEqual([2, 3, 40]);
  });
});

describe("liquidity surface", () => {
  it("accumulates notional outward from the mid on each side", () => {
    const engine = new SurfaceEngine();
    const bids = new Map([[99.99, 1], [99.9, 2]]); // 1 bp and 10 bps away
    const asks = new Map([[100.01, 3]]);
    engine.sample(T0, input({ sides: [{ bids, asks }], mid: 100 }));
    const column = engine.liquidity.last!;
    expect(column.depth[LIQUIDITY_HALF]).toBe(0);
    expect(column.depth[LIQUIDITY_HALF - 1]).toBeCloseTo(99.99); // first bid step
    expect(column.depth[LIQUIDITY_HALF - 5]).toBeCloseTo(99.99 + 199.8); // both bids by 10 bps
    expect(column.depth[LIQUIDITY_HALF + 1]).toBeCloseTo(300.03);
    expect(column.depth[LIQUIDITY_HALF + LIQUIDITY_HALF]).toBeCloseTo(300.03);

    const frame = buildLiquidityFrame(engine, { windowMs: 120_000, now: T0, bandBps: 10 });
    expect(frame.rows).toBe(11);
    expect(frame.splitRow).toBe(5);
    expect(frame.firstCol).toBe(frame.cols - 1);
    expect(frame.values[(frame.cols - 1) * frame.rows]).toBeCloseTo(99.99 + 199.8);
  });
});

describe("liquidation model", () => {
  it("adds levels on rising OI and clears them when price trades through", () => {
    const engine = new SurfaceEngine();
    engine.onTrade(100, 1, "buy");
    engine.sample(T0, input({ openInterest: 1000 }));
    engine.onTrade(100, 1, "buy");
    engine.sample(T0 + 1000, input({ openInterest: 1100 })); // +100 contracts at 100

    const column = engine.liquidation.last!;
    const longTotal = column.long.reduce((a, b) => a + b, 0);
    const shortTotal = column.short.reduce((a, b) => a + b, 0);
    // Each new contract is a long and a short: the two sides sum to 2 × ΔOI notional.
    expect(longTotal + shortTotal).toBeCloseTo(100 * 100, 0);
    // Buyers were the aggressor, so longs get the larger share.
    expect(longTotal).toBeGreaterThan(shortTotal);
    const highestLeverage = LEVERAGE_TIERS[LEVERAGE_TIERS.length - 1].leverage;
    const nearestLong = Math.round(liquidationPrices(100, highestLeverage).long / engine.binSize);
    expect(column.bins).toContain(nearestLong);

    // Price falls through the 100× long level: it's gone, deeper ones remain.
    engine.onTrade(99.0, 1, "sell");
    engine.sample(T0 + 2000, input({ openInterest: 1100 }));
    const after = engine.liquidation.last!;
    const index = Array.from(after.bins).indexOf(nearestLong);
    expect(index === -1 || after.long[index] === 0).toBe(true);
    expect(after.long.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("shrinks every level when open interest falls", () => {
    const engine = new SurfaceEngine();
    engine.onTrade(100, 1, "buy");
    engine.sample(T0, input({ openInterest: 1000 }));
    engine.sample(T0 + 1000, input({ openInterest: 1200 }));
    const before = engine.liquidation.last!.short.reduce((a, b) => a + b, 0);
    engine.sample(T0 + 2000, input({ openInterest: 600 }));
    const after = engine.liquidation.last!.short.reduce((a, b) => a + b, 0);
    expect(after).toBeCloseTo(before * 0.5, 3);

    const frame = buildLiquidationFrame(engine, { windowMs: 120_000, now: T0 + 2000, rangePct: 5 });
    expect(frame.path![frame.cols - 1]).toBeGreaterThan(0);
    expect(frame.rows).toBeGreaterThan(10);
  });
});

describe("flow profile", () => {
  it("attributes ΔOI to the prices traded that second, by volume", () => {
    const engine = new SurfaceEngine();
    engine.onTrade(100, 1, "buy");
    engine.sample(T0, input({ openInterest: 1000 }));
    engine.onTrade(100, 3, "buy");
    engine.onTrade(101, 1, "sell");
    engine.sample(T0 + 1000, input({ openInterest: 1010 }));
    const column = engine.flow.last!;
    const totalDoi = column.doi.reduce((a, b) => a + b, 0);
    const vwap = (300 + 101) / 4;
    expect(totalDoi).toBeCloseTo(10 * vwap, 3);
    const at100 = column.doi[Array.from(column.bins).indexOf(Math.round(100 / engine.binSize))];
    expect(at100 / totalDoi).toBeCloseTo(300 / 401, 3);

    const cumulative = buildFlowFrame(engine, { windowMs: 120_000, now: T0 + 1000, metric: "volume", cumulative: true });
    const last = cumulative.cols - 1;
    let sum = 0;
    for (let r = 0; r < cumulative.rows; r++) sum += cumulative.values[last * cumulative.rows + r];
    expect(sum).toBeCloseTo(100 + 300 + 101, 3); // both seconds' volume
    const slice = buildFlowFrame(engine, { windowMs: 120_000, now: T0 + 1000, metric: "delta", cumulative: false });
    let delta = 0;
    for (let r = 0; r < slice.rows; r++) delta += slice.values[last * slice.rows + r];
    expect(delta).toBeCloseTo(300 - 101, 3); // last second only
    expect(slice.signed).toBe(true);
  });
});

describe("funding surface", () => {
  it("annualizes per venue and forward-fills venues that go quiet", () => {
    const engine = new SurfaceEngine();
    engine.setVenues(["binance-futures", "hyperliquid"]);
    const binance: DerivativesSnapshot = { venue: "binance-futures", timestamp: T0, fundingRate: 0.0001, fundingIntervalHours: 8, markPrice: 100.1, indexPrice: 100 };
    const hyper: DerivativesSnapshot = { venue: "hyperliquid", timestamp: T0, fundingRate: 0.0000125, fundingIntervalHours: 1 };
    engine.sample(T0, input({ derivatives: [binance, hyper] }));
    engine.sample(T0 + 1000, input({ derivatives: [{ venue: "binance-futures", timestamp: T0 + 1000 }] }));
    const column = engine.funding.last!;
    expect(column.apr[0]).toBeCloseTo(10.95, 2); // 0.01% × 3 × 365
    expect(column.apr[1]).toBeCloseTo(10.95, 2); // hourly 0.00125% restated
    expect(column.premium[0]).toBeCloseTo(10, 3);

    const apr = buildFundingFrame(engine, { windowMs: 120_000, now: T0 + 1000, metric: "apr" });
    expect(apr.venues).toEqual(["binance-futures", "hyperliquid"]);
    const premium = buildFundingFrame(engine, { windowMs: 120_000, now: T0 + 1000, metric: "premium" });
    expect(premium.venues).toEqual(["binance-futures"]);
    expect(premium.frame.signed).toBe(true);
  });
});
