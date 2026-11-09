import {
  aggregateDerivatives,
  annualizeFunding,
  bucketLiquidations,
  classifyOIRegime,
  fundingRate8h,
  isLiquidationCascade,
  mergeDerivatives,
  oiWindowChange,
  summarizeLiquidations,
} from "@/lib/engine/derivatives";
import {
  BitgetFuturesAdapter,
  BybitFuturesAdapter,
  DeribitAdapter,
  HyperliquidAdapter,
  OKXFuturesAdapter,
} from "@/lib/adapters/exchanges";
import { BinanceFuturesAdapter } from "@/lib/adapters/binanceFutures";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type { DerivativesSnapshot, NormalizedLiquidation, OpenInterestPoint } from "@/lib/types/market";

function liq(timestamp: number, side: "long" | "short", quoteVolume: number): NormalizedLiquidation {
  return {
    id: `${timestamp}-${side}`,
    venue: "bybit-futures",
    symbol: "BTCUSDT",
    timestamp,
    localTimestamp: timestamp,
    price: 100,
    quantity: quoteVolume / 100,
    quoteVolume,
    side,
  };
}

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (adapter as unknown as { handleMessage: (m: unknown) => void }).handleMessage(payload);
}

function collect<T>(adapter: BaseExchangeAdapter, event: "liquidation" | "derivatives", payload: unknown): T[] {
  const out: T[] = [];
  adapter.on(event, (value: T) => out.push(value));
  feed(adapter, payload);
  return out;
}

describe("derivatives engine", () => {
  it("merges partial venue updates without dropping known fields", () => {
    const first = mergeDerivatives(undefined, { venue: "bybit-futures", timestamp: 1, openInterest: 100, fundingRate: 0.0001 });
    const next = mergeDerivatives(first, { venue: "bybit-futures", timestamp: 2, markPrice: 50_000 });
    expect(next).toEqual({ venue: "bybit-futures", timestamp: 2, openInterest: 100, fundingRate: 0.0001, markPrice: 50_000 });
  });

  it("normalizes funding to an 8h interval and annualizes it", () => {
    expect(fundingRate8h({ venue: "hyperliquid", timestamp: 0, fundingRate: 0.00001, fundingIntervalHours: 1 })).toBeCloseTo(0.00008);
    expect(fundingRate8h({ venue: "bybit-futures", timestamp: 0, fundingRate: 0.0001 })).toBeCloseTo(0.0001);
    expect(annualizeFunding(0.0001, 8)).toBeCloseTo(0.1095);
  });

  it("sums OI, weights funding and basis by OI, and respects the locked venue set", () => {
    const snapshots: DerivativesSnapshot[] = [
      { venue: "bybit-futures", timestamp: 10, openInterest: 300, fundingRate: 0.0001, fundingIntervalHours: 8, nextFundingTime: 1000, markPrice: 101, indexPrice: 100 },
      { venue: "hyperliquid", timestamp: 20, openInterest: 100, fundingRate: 0.00001, fundingIntervalHours: 1, markPrice: 100, indexPrice: 100 },
    ];
    const agg = aggregateDerivatives(snapshots, "bybit-futures", 100)!;
    expect(agg.openInterest).toBe(400);
    expect(agg.openInterestValue).toBeCloseTo(300 * 101 + 100 * 100);
    // (0.0001 × 300 + 0.00008 × 100) / 400
    expect(agg.fundingRate8h).toBeCloseTo(0.000095);
    expect(agg.primaryFundingRate).toBe(0.0001);
    expect(agg.nextFundingTime).toBe(1000);
    // (100 bp × 300 + 0 × 100) / 400
    expect(agg.basisBps).toBeCloseTo(75);
    expect(agg.timestamp).toBe(20);

    const locked = aggregateDerivatives(snapshots, "bybit-futures", 100, new Set(["bybit-futures"]))!;
    expect(locked.openInterest).toBe(300);
  });

  it("returns null OI when no venue has reported it", () => {
    const agg = aggregateDerivatives([{ venue: "deribit", timestamp: 1, fundingRate: 0 }], "deribit", 100)!;
    expect(agg.openInterest).toBeNull();
    expect(agg.fundingRate8h).toBe(0);
  });

  it("classifies the four price × OI regimes and treats small moves as flat", () => {
    expect(classifyOIRegime(0.01, 0.01)).toBe("new-longs");
    expect(classifyOIRegime(0.01, -0.01)).toBe("short-covering");
    expect(classifyOIRegime(-0.01, 0.01)).toBe("new-shorts");
    expect(classifyOIRegime(-0.01, -0.01)).toBe("long-unwind");
    expect(classifyOIRegime(0.0001, 0.05)).toBe("neutral");
    expect(classifyOIRegime(0.05, 0.0001)).toBe("neutral");
  });

  it("measures the OI and price change over a trailing window", () => {
    const history: OpenInterestPoint[] = Array.from({ length: 601 }, (_, i) => ({
      time: i * 1000,
      openInterest: 1000 + i,
      price: 100 - i * 0.01,
    }));
    const change = oiWindowChange(history, 300_000)!;
    expect(change.from.time).toBe(300_000);
    expect(change.oiDelta).toBe(300);
    expect(change.oiChange).toBeCloseTo(300 / 1300);
    expect(change.priceChange).toBeCloseTo((94 - 97) / 97);
    expect(change.regime).toBe("new-shorts");
    expect(oiWindowChange(history.slice(0, 1), 300_000)).toBeNull();
  });

  it("buckets liquidations by side, including empty buckets", () => {
    const now = 60_500;
    const buckets = bucketLiquidations(
      [liq(1_000, "long", 500), liq(59_000, "long", 100), liq(59_500, "short", 50), liq(60_100, "short", 25)],
      10_000,
      7,
      now
    );
    expect(buckets.map((b) => b.time)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);
    expect(buckets[0].longNotional).toBe(500);
    expect(buckets[5]).toMatchObject({ longNotional: 100, shortNotional: 50, count: 2 });
    expect(buckets[6]).toMatchObject({ shortNotional: 25, count: 1 });
    expect(buckets[1].count).toBe(0);
  });

  it("summarizes recent liquidations and flags cascades against the median bucket", () => {
    const list = [liq(0, "long", 10), liq(5_000, "short", 40), liq(9_000, "long", 30)];
    const summary = summarizeLiquidations(list, 4_000);
    expect(summary).toMatchObject({ longNotional: 30, shortNotional: 40, count: 2 });
    expect(summary.largest?.quoteVolume).toBe(40);

    // A slightly out-of-order older record must not hide newer ones behind it.
    const shuffled = [liq(100_000, "long", 5), liq(170_000, "short", 7), liq(160_000, "long", 9)];
    expect(summarizeLiquidations(shuffled, 165_000)).toMatchObject({ shortNotional: 7, longNotional: 0, count: 1 });
    const outOfOrder = [liq(170_000, "long", 5), liq(150_000, "long", 9), liq(171_000, "short", 7)];
    expect(summarizeLiquidations(outOfOrder, 160_000)).toMatchObject({ longNotional: 5, shortNotional: 7, count: 2 });

    const quiet = [10, 12, 9, 11, 10].map((v, i) => ({ time: i, longNotional: v, shortNotional: 0, longQty: 0, shortQty: 0, count: 1 }));
    expect(isLiquidationCascade(quiet)).toBe(false);
    const spike = [...quiet, { time: 9, longNotional: 80, shortNotional: 0, longQty: 0, shortQty: 0, count: 5 }];
    expect(isLiquidationCascade(spike)).toBe(true);
  });
});

describe("derivatives adapter payloads", () => {
  it("parses Binance forceOrder and markPrice updates", () => {
    const adapter = new BinanceFuturesAdapter("BTCUSDT");
    const liqs = collect<NormalizedLiquidation>(adapter, "liquidation", {
      e: "forceOrder",
      E: 1,
      o: { s: "BTCUSDT", S: "SELL", q: "0.5", p: "49000", ap: "49100", X: "FILLED", z: "0.5", T: 1700000000000 },
    });
    expect(liqs).toHaveLength(1);
    expect(liqs[0]).toMatchObject({ side: "long", price: 49100, quantity: 0.5, quoteVolume: 24550, venue: "binance-futures" });

    const derivs = collect<DerivativesSnapshot>(adapter, "derivatives", {
      e: "markPriceUpdate", E: 1700000000000, s: "BTCUSDT", p: "50010", i: "50000", r: "0.00010000", T: 1700006400000,
    });
    expect(derivs[0]).toMatchObject({ markPrice: 50010, indexPrice: 50000, fundingRate: 0.0001, nextFundingTime: 1700006400000 });
  });

  it("parses Binance partial depth from the public route", () => {
    const adapter = new BinanceFuturesAdapter("BTCUSDT");
    const books: unknown[] = [];
    adapter.on("orderbook", (b) => books.push(b));
    feed(adapter, { e: "depthUpdate", s: "BTCUSDT", b: [["49999", "1.2"]], a: [["50001", "0.8"]] });
    expect(books).toHaveLength(1);
  });

  it("parses Bybit tickers deltas and allLiquidation", () => {
    const adapter = new BybitFuturesAdapter("BTCUSDT");
    const derivs = collect<DerivativesSnapshot>(adapter, "derivatives", {
      topic: "tickers.BTCUSDT",
      type: "snapshot",
      data: { symbol: "BTCUSDT", markPrice: "74104.4", indexPrice: "74140.23", openInterest: "70329.009", fundingIntervalHour: "8", nextFundingTime: "1794240000000", fundingRate: "0.0000561" },
    });
    expect(derivs[0]).toMatchObject({ openInterest: 70329.009, fundingRate: 0.0000561, fundingIntervalHours: 8, markPrice: 74104.4 });
    // A delta with only book fields carries no derivatives data.
    expect(collect(adapter, "derivatives", { topic: "tickers.BTCUSDT", type: "delta", data: { bid1Price: "1" } })).toHaveLength(0);

    const liqs = collect<NormalizedLiquidation>(new BybitFuturesAdapter("ETHUSDT"), "liquidation", {
      topic: "allLiquidation.ETHUSDT",
      type: "snapshot",
      data: [{ T: 1794212592612, s: "ETHUSDT", S: "Buy", v: "10.09", p: "2111.68" }],
    });
    expect(liqs[0]).toMatchObject({ side: "long", quantity: 10.09, price: 2111.68 });
  });

  it("parses OKX OI, funding, mark/index and filters liquidations by instrument", () => {
    const adapter = new OKXFuturesAdapter("BTCUSDT");
    (adapter as unknown as { contractValue: number }).contractValue = 0.01;
    const derivs: DerivativesSnapshot[] = [];
    adapter.on("derivatives", (d: DerivativesSnapshot) => derivs.push(d));
    feed(adapter, { arg: { channel: "open-interest" }, data: [{ oiCcy: "35042.88", ts: "1794212571584" }] });
    feed(adapter, { arg: { channel: "funding-rate" }, data: [{ fundingRate: "0.0001", fundingTime: "1794240000000", nextFundingTime: "1794268800000" }] });
    feed(adapter, { arg: { channel: "mark-price" }, data: [{ markPx: "74109.7" }] });
    feed(adapter, { arg: { channel: "index-tickers" }, data: [{ idxPx: "74140.8" }] });
    expect(derivs).toEqual([
      expect.objectContaining({ openInterest: 35042.88 }),
      expect.objectContaining({ fundingRate: 0.0001, nextFundingTime: 1794240000000, fundingIntervalHours: 8 }),
      expect.objectContaining({ markPrice: 74109.7 }),
      expect.objectContaining({ indexPrice: 74140.8 }),
    ]);

    const liqs = collect<NormalizedLiquidation>(adapter, "liquidation", {
      arg: { channel: "liquidation-orders" },
      data: [
        { instId: "XRP-USDT-SWAP", details: [{ side: "buy", posSide: "short", bkPx: "1.09", sz: "1", ts: "1" }] },
        { instId: "BTC-USDT-SWAP", details: [{ side: "sell", posSide: "net", bkPx: "74000", sz: "50", ts: "1794212578210" }] },
      ],
    });
    expect(liqs).toHaveLength(1);
    expect(liqs[0]).toMatchObject({ side: "long", quantity: 0.5, price: 74000 });
  });

  it("parses Bitget ticker derivatives fields", () => {
    const derivs = collect<DerivativesSnapshot>(new BitgetFuturesAdapter("BTCUSDT"), "derivatives", {
      arg: { instType: "USDT-FUTURES", channel: "ticker", instId: "BTCUSDT" },
      data: [{ fundingRate: "0.0001", nextFundingTime: "1794240000000", markPrice: "74110", indexPrice: "74141.93", holdingAmount: "37692.36", ts: "1794212575996" }],
    });
    expect(derivs[0]).toMatchObject({ openInterest: 37692.36, fundingRate: 0.0001, markPrice: 74110, timestamp: 1794212575996 });
  });

  it("parses Hyperliquid activeAssetCtx with hourly funding", () => {
    const derivs = collect<DerivativesSnapshot>(new HyperliquidAdapter("BTCUSDT"), "derivatives", {
      channel: "activeAssetCtx",
      data: { coin: "BTC", ctx: { funding: "0.0000071334", openInterest: "41508.48606", oraclePx: "74133.4", markPx: "74099.0" } },
    });
    expect(derivs[0]).toMatchObject({ openInterest: 41508.48606, fundingIntervalHours: 1, markPrice: 74099, indexPrice: 74133.4 });
    expect(derivs[0].nextFundingTime! % 3_600_000).toBe(0);
  });

  it("parses Deribit ticker (USD open interest) and liquidation trades", () => {
    const adapter = new DeribitAdapter("BTCUSDT");
    const derivs = collect<DerivativesSnapshot>(adapter, "derivatives", {
      method: "subscription",
      params: { channel: "ticker.BTC-PERPETUAL.100ms", data: { open_interest: 740_000_000, funding_8h: 0.00006808, mark_price: 74_000, index_price: 74_042.43, timestamp: 1 } },
    });
    expect(derivs[0].openInterest).toBeCloseTo(10_000);
    expect(derivs[0]).toMatchObject({ fundingRate: 0.00006808, fundingIntervalHours: 8 });

    const liqs = collect<NormalizedLiquidation>(adapter, "liquidation", {
      method: "subscription",
      params: {
        channel: "trades.BTC-PERPETUAL.100ms",
        data: [
          { trade_id: "1", instrument_name: "BTC-PERPETUAL", price: 74000, amount: 7400, direction: "sell", timestamp: 1, liquidation: "T" },
          { trade_id: "2", instrument_name: "BTC-PERPETUAL", price: 74000, amount: 7400, direction: "sell", timestamp: 2, liquidation: "M" },
          { trade_id: "3", instrument_name: "BTC-PERPETUAL", price: 74000, amount: 7400, direction: "buy", timestamp: 3 },
        ],
      },
    });
    expect(liqs.map((l) => l.side)).toEqual(["long", "short"]);
    expect(liqs[0].quantity).toBeCloseTo(0.1);
  });
});
