import { DepthHistory, bookSides, depthPercentile } from "@/lib/engine/depthHistory";
import { LiquidityHeatmapRenderer } from "@/lib/render/liquidityHeatmap";
import { AbsorptionDetector, IcebergDetector } from "@/lib/engine/microstructure";
import { laggedCorrelation, venueSummary, VenueTracker, VENUE_BUCKET_MS } from "@/lib/engine/venues";
import { dayLevels, distributeVolume, nakedPocs, parseBinanceKlines, valueArea, DAY_MS, type Kline } from "@/lib/engine/priorSessions";
import type { NormalizedOrderBook, NormalizedTrade, Venue } from "@/lib/types/market";

const book = (venue: Venue, bids: [number, number][], asks: [number, number][], timestamp = 0): NormalizedOrderBook => ({
  venue, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp,
  bids: bids.map(([price, size]) => ({ price, size })),
  asks: asks.map(([price, size]) => ({ price, size })),
});

let tid = 0;
const trade = (price: number, quantity: number, side: "buy" | "sell", timestamp: number, venue: Venue = "bybit-futures"): NormalizedTrade => ({
  id: `t${++tid}`, venue, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp, price, quantity, quoteVolume: price * quantity, side, marketType: "perpetual",
});

describe("DepthHistory", () => {
  it("sums venues into tick buckets and looks snapshots up by time", () => {
    const h = new DepthHistory(4);
    h.add(1_000, [book("bybit-futures", [[99.9, 1], [99.4, 2]], [[100.1, 3]]), book("okx-futures", [[100.0, 4]], [[100.6, 1]])].map(bookSides), 1, 100);
    const snap = h.get(0)!;
    expect([...snap.index]).toEqual([99, 100, 101]);
    expect([...snap.size]).toEqual([2, 1 + 4 + 3, 1]);
    expect(LiquidityHeatmapRenderer.sizeAt(h, 1_000, 100)).toBe(8);
    expect(LiquidityHeatmapRenderer.sizeAt(h, 1_000, 105)).toBe(0);
    expect(LiquidityHeatmapRenderer.sizeAt(h, 9_000, 100)).toBeNull();
  });

  it("replaces a snapshot in the same second, wraps the ring and clears on a tick change", () => {
    const h = new DepthHistory(3);
    const b = [bookSides(book("bybit-futures", [[100, 1]], [[101, 1]]))];
    h.add(1_000, b, 1, 100);
    h.add(1_400, b, 1, 100);
    expect(h.size).toBe(1);
    for (let t = 2_000; t <= 5_000; t += 1_000) h.add(t, b, 1, 100);
    expect(h.size).toBe(3);
    expect(h.firstSeq).toBe(2);
    expect(h.get(1)).toBeUndefined();
    expect(h.seqAtOrAfter(3_500)).toBe(h.firstSeq + 1);
    expect(depthPercentile(h, h.firstSeq, h.lastSeq)).toBe(1);
    const epoch = h.epoch;
    h.add(6_000, b, 0.5, 100);
    expect(h.epoch).toBe(epoch + 1);
    expect(h.size).toBe(1);
  });

  it("ignores levels beyond ±3% of mid (full-depth books)", () => {
    const h = new DepthHistory(4);
    const snap = h.add(1_000, [{ bids: new Map([[99, 1], [50, 100]]), asks: new Map([[101, 1], [500, 100]]) }], 1, 100)!;
    expect([...snap.index]).toEqual([99, 101]);
    expect(h.add(2_000, [{ bids: new Map([[10, 1]]), asks: new Map() }], 1, 100)).toBeNull();
  });
});

describe("AbsorptionDetector", () => {
  it("flags heavy selling at a bid that held, after warm-up", () => {
    const d = new AbsorptionDetector(1);
    // Six quiet 10 s windows of 10 units each.
    for (let w = 0; w < 6; w++) for (let i = 0; i < 10; i++) d.onTrade(trade(100 + (i % 2), 1, i % 2 ? "buy" : "sell", w * 10_000 + i * 500));
    // Window 6: 30 units sold into 100 while price holds at 100–101.
    for (let i = 0; i < 30; i++) d.onTrade(trade(100, 1, "sell", 60_000 + i * 100));
    d.onTrade(trade(101, 1, "buy", 69_000));
    const events = d.onTrade(trade(101, 1, "buy", 70_000)); // closes the window
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "absorption", side: "bid", price: 100, volume: 30 });
    expect(events[0].ratio).toBeCloseTo(3);
  });

  it("does not flag when price trades through the level", () => {
    const d = new AbsorptionDetector(1);
    for (let w = 0; w < 6; w++) for (let i = 0; i < 10; i++) d.onTrade(trade(100, 1, i % 2 ? "buy" : "sell", w * 10_000 + i * 500));
    for (let i = 0; i < 30; i++) d.onTrade(trade(100, 1, "sell", 60_000 + i * 100));
    d.onTrade(trade(97, 1, "sell", 69_000)); // broke 3 ticks below
    expect(d.onTrade(trade(97, 1, "sell", 70_000))).toHaveLength(0);
  });
});

describe("IcebergDetector", () => {
  it("confirms a level that traded through its size and refilled", () => {
    const d = new IcebergDetector();
    let b = book("bybit-futures", [[100, 5]], [[101, 5]]);
    for (let i = 0; i < 4; i++) {
      d.onTrade(trade(100, 3, "sell", 1_000 + i * 200), b);
      b = book("bybit-futures", [[100, i % 2 ? 5 : 2]], [[101, 5]]); // dips, then refills
      d.onBook(b);
    }
    expect(d.evaluate(2_000, 1)).toHaveLength(0); // still active
    const events = d.evaluate(6_000, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "iceberg", side: "bid", price: 100, volume: 12, venue: "bybit-futures" });
    expect(events[0].ratio).toBeCloseTo(12 / 5);
  });

  it("ignores levels that were simply consumed", () => {
    const d = new IcebergDetector();
    const b = book("bybit-futures", [[100, 5]], [[101, 5]]);
    d.onTrade(trade(100, 6, "sell", 1_000), b);
    d.onBook(book("bybit-futures", [[99, 5]], [[101, 5]]));
    expect(d.evaluate(10_000, 1)).toHaveLength(0);
  });
});

describe("cross-venue lead/lag", () => {
  it("finds the venue whose price moves first", () => {
    const tracker = new VenueTracker();
    // A random walk on venue A, copied to B two buckets (500 ms) later.
    let price = 100;
    const path: number[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < 700; i++) path.push((price *= 1 + rand() * 0.001));
    for (let i = 0; i < 700; i++) {
      const t = i * VENUE_BUCKET_MS;
      tracker.onTrade(trade(path[i], 1, "buy", t, "binance-futures"));
      if (i >= 2) tracker.onTrade(trade(path[i - 2], 2, "sell", t, "bybit-futures"));
    }
    const now = 700 * VENUE_BUCKET_MS;
    const { stats, leader } = venueSummary(tracker.snapshot(), now);
    expect(leader?.venue).toBe("binance-futures");
    expect(leader?.leadMs).toBe(500);
    const bybit = stats.find((s) => s.venue === "bybit-futures")!;
    expect(bybit.leadMs).toBe(-500);
    expect(bybit.share).toBeCloseTo(2 / 3, 1);
    expect(bybit.delta).toBeLessThan(0);
  });

  it("computes lagged correlation", () => {
    const a = Float64Array.from({ length: 50 }, (_, i) => Math.sin(i));
    const b = Float64Array.from({ length: 50 }, (_, i) => Math.sin(i - 1));
    expect(laggedCorrelation(a, b, 1)).toBeCloseTo(1, 5);
    expect(laggedCorrelation(a, a, 0)).toBeCloseTo(1, 5);
  });
});

describe("prior sessions", () => {
  const day0 = 10 * DAY_MS;
  const k = (openTime: number, low: number, high: number, volume: number, vwap = (low + high) / 2): Kline => ({ openTime, low, high, close: high, volume, quoteVolume: volume * vwap });

  it("parses Binance rows", () => {
    expect(parseBinanceKlines([[1, "1", "3", "0.5", "2", "10", 2, "20"]])[0]).toEqual({ openTime: 1, high: 3, low: 0.5, close: 2, volume: 10, quoteVolume: 20 });
  });

  it("distributes volume across each bar's range and finds the value area", () => {
    const profile = distributeVolume([k(0, 100, 104, 50), k(1, 102, 102, 30)], 1);
    expect(profile.get(102)).toBe(40);
    expect(profile.get(100)).toBe(10);
    // Equal neighbours expand upward first: 102 → 103 → 104 reaches 70%.
    expect(valueArea(profile, 0.7)).toEqual({ poc: 102, vah: 104, val: 102 });
  });

  it("builds per-day levels and naked POCs", () => {
    const klines = [
      k(day0, 100, 110, 100, 105), k(day0 + 1000, 105, 105, 300, 105), // day 0: POC 105
      k(day0 + DAY_MS, 120, 130, 100), k(day0 + DAY_MS + 1000, 125, 125, 300), // day 1: POC 125, range 120–130
      k(day0 + 2 * DAY_MS, 118, 135, 10), // today: not a complete day
    ];
    const days = dayLevels(klines, 1, 0.7, day0 + 2 * DAY_MS);
    expect(days.map((d) => d.day)).toEqual([day0, day0 + DAY_MS]);
    expect(days[0].poc).toBe(105);
    expect(days[0].vwap).toBeCloseTo(105);
    expect(days[1]).toMatchObject({ poc: 125, high: 130, low: 120 });
    // Day 0's POC (105) was never revisited; day 1's (125) was touched today (118–135).
    expect(nakedPocs(days, 135, 118).map((d) => d.poc)).toEqual([105]);
    expect(nakedPocs(days, 140, 131).map((d) => d.poc)).toEqual([125, 105]);
  });
});
