import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import { GateFuturesAdapter, GateSpotAdapter } from "@/lib/adapters/gate";
import { HtxFuturesAdapter, HtxSpotAdapter } from "@/lib/adapters/htx";
import { KrakenFuturesAdapter, KrakenSpotAdapter, krakenSymbol } from "@/lib/adapters/kraken";
import { KucoinFuturesAdapter, KucoinSpotAdapter, kucoinSymbol } from "@/lib/adapters/kucoin";
import type { NormalizedLiquidation, NormalizedOrderBook, NormalizedTrade, VenueConnection } from "@/lib/types/market";

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (adapter as unknown as { handleMessage: (message: unknown) => void }).handleMessage(payload);
}
function collect(adapter: BaseExchangeAdapter) {
  const trades: NormalizedTrade[] = [];
  const books: NormalizedOrderBook[] = [];
  const liquidations: NormalizedLiquidation[] = [];
  const statuses: VenueConnection[] = [];
  adapter.on("trade", (t) => trades.push(t));
  adapter.on("orderbook", (b) => books.push(b));
  adapter.on("liquidation", (l) => liquidations.push(l));
  adapter.on("status", (s) => statuses.push(s));
  return { trades, books, liquidations, statuses };
}
const set = (adapter: object, field: string, value: number) => { (adapter as Record<string, number>)[field] = value; };

describe("Gate", () => {
  it("parses spot trades and top-20 book snapshots", () => {
    const adapter = new GateSpotAdapter("BTCUSDT");
    const { trades, books } = collect(adapter);
    feed(adapter, { channel: "spot.trades", event: "update", result: { id: 7, create_time_ms: "1700000000123.4", side: "sell", currency_pair: "BTC_USDT", amount: "0.5", price: "50000" } });
    feed(adapter, { channel: "spot.order_book", event: "update", result: { s: "BTC_USDT", bids: [["49999", "1"]], asks: [["50001", "2"]] } });
    expect(trades[0]).toMatchObject({ venue: "gate-spot", price: 50000, quantity: 0.5, side: "sell", timestamp: 1700000000123 });
    expect(books[0].bids[0]).toMatchObject({ price: 49999, size: 1 });
  });

  it("converts perp contracts to base units and reads signed sizes", () => {
    const adapter = new GateFuturesAdapter("BTCUSDT");
    set(adapter, "multiplier", 0.0001);
    const { trades, books, liquidations } = collect(adapter);
    feed(adapter, { channel: "futures.trades", event: "update", result: [{ id: 1, create_time_ms: 1, contract: "BTC_USDT", size: -300, price: "50000" }] });
    feed(adapter, { channel: "futures.order_book", event: "all", result: { contract: "BTC_USDT", bids: [{ p: "49999", s: 1000 }], asks: [{ p: "50001", s: 2000 }] } });
    feed(adapter, { channel: "futures.public_liquidates", event: "update", result: [{ contract: "BTC_USDT", price: 49000, size: -500, time_ms: 2 }] });
    expect(trades[0].side).toBe("sell");
    expect(trades[0].quantity).toBeCloseTo(0.03);
    expect(books[0].asks[0].size).toBeCloseTo(0.2);
    expect(liquidations[0].side).toBe("long");
    expect(liquidations[0].quantity).toBeCloseTo(0.05);
  });
});

describe("KuCoin", () => {
  it("maps symbols to KuCoin's spot and USDT-M ids", () => {
    expect(kucoinSymbol("BTCUSDT", false)).toBe("BTC-USDT");
    expect(kucoinSymbol("BTCUSDT", true)).toBe("XBTUSDTM");
    expect(kucoinSymbol("ETHUSDT", true)).toBe("ETHUSDTM");
  });

  it("parses nanosecond trades and depth50 snapshots", () => {
    const spot = new KucoinSpotAdapter("BTCUSDT");
    const s = collect(spot);
    feed(spot, { type: "message", topic: "/market/match:BTC-USDT", data: { tradeId: "a1", symbol: "BTC-USDT", side: "buy", size: "0.1", price: "50000", time: "1700000000123456789" } });
    expect(s.trades[0]).toMatchObject({ timestamp: 1700000000123, quantity: 0.1, side: "buy" });

    const perp = new KucoinFuturesAdapter("BTCUSDT");
    set(perp, "multiplier", 0.001);
    const p = collect(perp);
    feed(perp, { type: "message", topic: "/contractMarket/execution:XBTUSDTM", data: { tradeId: "b1", symbol: "XBTUSDTM", side: "sell", size: 25, price: "50000", ts: 1700000000123456789 } });
    feed(perp, { type: "message", topic: "/contractMarket/level2Depth50:XBTUSDTM", data: { bids: [["49999", 100]], asks: [["50001", 200]] } });
    expect(p.trades[0].side).toBe("sell");
    expect(p.trades[0].quantity).toBeCloseTo(0.025);
    expect(p.books[0].bids[0].size).toBeCloseTo(0.1);
  });
});

describe("Kraken", () => {
  it("maps symbols to BASE/USD spot and PF_ perpetuals", () => {
    expect(krakenSymbol("BTCUSDT", false)).toBe("BTC/USD");
    expect(krakenSymbol("BTCUSDT", true)).toBe("PF_XBTUSD");
    expect(krakenSymbol("SOLUSDT", true)).toBe("PF_SOLUSD");
  });

  it("builds the spot book from a snapshot and applies qty-0 removals", () => {
    const adapter = new KrakenSpotAdapter("BTCUSDT");
    const { books } = collect(adapter);
    feed(adapter, { channel: "book", type: "update", data: [{ symbol: "BTC/USD", bids: [{ price: 1, qty: 1 }], asks: [] }] }); // before snapshot
    feed(adapter, { channel: "book", type: "snapshot", data: [{ symbol: "BTC/USD", bids: [{ price: 100, qty: 1 }, { price: 99, qty: 2 }], asks: [{ price: 101, qty: 1 }] }] });
    feed(adapter, { channel: "book", type: "update", data: [{ symbol: "BTC/USD", bids: [{ price: 100, qty: 0 }], asks: [] }] });
    expect(books).toHaveLength(2);
    expect(books[1].bids).toEqual([expect.objectContaining({ price: 99, size: 2 })]);
  });

  it("reports liquidation fills and resubscribes on a futures book seq gap", () => {
    const adapter = new KrakenFuturesAdapter("BTCUSDT");
    const { trades, liquidations, statuses } = collect(adapter);
    feed(adapter, { feed: "trade", product_id: "PF_XBTUSD", uid: "u1", side: "sell", type: "liquidation", time: 5, qty: 0.5, price: 50000 });
    expect(trades).toHaveLength(1);
    expect(liquidations[0]).toMatchObject({ side: "long", quantity: 0.5 });

    feed(adapter, { feed: "book_snapshot", product_id: "PF_XBTUSD", seq: 10, bids: [{ price: 100, qty: 1 }], asks: [{ price: 101, qty: 1 }] });
    feed(adapter, { feed: "book", product_id: "PF_XBTUSD", seq: 11, side: "buy", price: 99, qty: 3 });
    feed(adapter, { feed: "book", product_id: "PF_XBTUSD", seq: 13, side: "buy", price: 98, qty: 3 });
    expect(statuses.at(-1)?.status).toBe("stale");
    expect(adapter.depthSides()).toBeNull();
  });
});

describe("HTX", () => {
  it("gives every swap fill a unique id despite oversized raw ids", () => {
    const adapter = new HtxFuturesAdapter("BTCUSDT");
    const { trades } = collect(adapter);
    // Raw fill ids (100134682519503 × 10^4 + i) exceed JS integer precision.
    const fill = (i: number) => ({ id: 1001346825195030000 + i, ts: 1, amount: 42, quantity: 0.042, price: 50000, direction: "sell" });
    feed(adapter, { ch: "market.BTC-USDT.trade.detail", tick: { id: 100134682519503, data: [fill(0), fill(1), fill(2)] } });
    expect(new Set(trades.map((t) => t.id)).size).toBe(3);
    expect(trades[0]).toMatchObject({ quantity: 0.042, side: "sell", marketType: "perpetual" });
  });

  it("parses spot trades and scales swap books by contract size", () => {
    const spot = new HtxSpotAdapter("BTCUSDT");
    const s = collect(spot);
    feed(spot, { ch: "market.btcusdt.trade.detail", tick: { id: 1, data: [{ tradeId: 9, ts: 1, amount: 0.2, price: 50000, direction: "buy" }] } });
    expect(s.trades[0]).toMatchObject({ venue: "htx-spot", quantity: 0.2, side: "buy" });

    const perp = new HtxFuturesAdapter("BTCUSDT");
    set(perp, "contractSize", 0.001);
    const p = collect(perp);
    feed(perp, { ch: "market.BTC-USDT.depth.step0", tick: { bids: [[49999, 1000]], asks: [[50001, 500]] } });
    expect(p.books[0].bids[0]).toMatchObject({ price: 49999, size: 1 });
  });
});
