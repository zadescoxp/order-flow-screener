import {
  BinanceSpotAdapter,
  BybitFuturesAdapter,
  BybitSpotAdapter,
  CoinbaseSpotAdapter,
  DeribitAdapter,
  HyperliquidAdapter,
  OKXFuturesAdapter,
  OKXSpotAdapter,
  BitgetFuturesAdapter,
  BitgetSpotAdapter,
} from "@/lib/adapters/exchanges";
import { BinanceFuturesAdapter } from "@/lib/adapters/binanceFutures";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (
    adapter as unknown as { handleMessage: (message: unknown) => void }
  ).handleMessage(payload);
}

function expectTrade(adapter: BaseExchangeAdapter, payload: unknown): void {
  const trades: unknown[] = [];
  adapter.on("trade", (trade) => trades.push(trade));
  feed(adapter, payload);
  expect(trades).toHaveLength(1);
}

describe("exchange adapter payload fixtures", () => {
  it("normalizes Binance futures aggregate trades and depth", () => {
    const adapter = new BinanceFuturesAdapter("BTCUSDT");
    expectTrade(adapter, {
      e: "aggTrade",
      a: 123,
      s: "BTCUSDT",
      p: "50000.0",
      q: "0.01",
      T: 1700000000000,
      m: false,
    });
    const books: unknown[] = [];
    adapter.on("orderbook", (book) => books.push(book));
    feed(adapter, {
      lastUpdateId: 42,
      bids: [["49999", "1.2"]],
      asks: [["50001", "0.8"]],
    });
    expect(books).toHaveLength(1);
  });

  it("normalizes Binance spot trades", () => {
    expectTrade(new BinanceSpotAdapter("BTCUSDT"), {
      e: "trade",
      t: 123,
      s: "BTCUSDT",
      p: "50000",
      q: "0.01",
      T: 1700000000000,
      m: true,
    });
  });

  it.each([
    ["Bybit futures", new BybitFuturesAdapter("BTCUSDT")],
    ["Bybit spot", new BybitSpotAdapter("BTCUSDT")],
  ])("normalizes %s trades", (_name, adapter) => {
    expectTrade(adapter, {
      topic: "publicTrade.BTCUSDT",
      data: [{ T: 1700000000000, S: "Buy", v: "0.01", p: "50000", i: "1", s: "BTCUSDT" }],
    });
  });

  it("builds the Bybit book only from a snapshot and resyncs on a sequence gap", () => {
    const adapter = new BybitFuturesAdapter("BTCUSDT");
    const books: Array<{ bids: Array<{ price: number }>; asks: Array<{ price: number }> }> = [];
    const statuses: string[] = [];
    adapter.on("orderbook", (book) => books.push(book));
    adapter.on("status", (s: { status: string }) => statuses.push(s.status));
    const delta = (u: number, b: [string, string][], a: [string, string][]) =>
      feed(adapter, { topic: "orderbook.1000.BTCUSDT", type: "delta", data: { s: "BTCUSDT", b, a, u, seq: u } });

    // Deltas before the first snapshot would build a partial book.
    delta(1, [["49999", "1"]], [["50001", "1"]]);
    expect(books).toHaveLength(0);

    feed(adapter, { topic: "orderbook.1000.BTCUSDT", type: "snapshot", data: { s: "BTCUSDT", b: [["49999", "1"]], a: [["50001", "1"]], u: 10, seq: 10 } });
    delta(11, [["49998", "2"]], [["50001", "0"], ["50002", "1"]]);
    expect(books).toHaveLength(2);
    expect(books[1].bids.map((l) => l.price)).toEqual([49999, 49998]);
    expect(books[1].asks.map((l) => l.price)).toEqual([50002]);

    // u jumps from 11 to 13: drop the book and wait for a fresh snapshot.
    delta(13, [["49997", "1"]], []);
    expect(statuses).toContain("stale");
    expect(adapter.depthSides()).toBeNull();
    delta(14, [["49996", "1"]], [["50003", "1"]]);
    expect(books).toHaveLength(2);
  });

  it.each([
    ["OKX futures", new OKXFuturesAdapter("BTCUSDT")],
    ["OKX spot", new OKXSpotAdapter("BTCUSDT")],
  ])("normalizes %s trades", (_name, adapter) => {
    expectTrade(adapter, {
      arg: { channel: "trades" },
      data: [{ tradeId: "1", instId: "BTC-USDT", px: "50000", sz: "0.01", side: "buy", ts: "1700000000000" }],
    });
  });

  it("normalizes Hyperliquid trades", () => {
    expectTrade(new HyperliquidAdapter("BTC"), {
      channel: "trades",
      data: [{ coin: "BTC", side: "B", px: "50000", sz: "0.01", time: 1700000000000, tid: 1 }],
    });
  });

  it.each([
    ["Bitget futures", new BitgetFuturesAdapter("BTCUSDT")],
    ["Bitget spot", new BitgetSpotAdapter("BTCUSDT")],
  ])("normalizes %s trades", (_name, adapter) => {
    expectTrade(adapter, {
      arg: { channel: "trade" },
      data: [["1700000000000", "50000", "0.01", "buy", "1"]],
    });
  });

  it.each([
    ["Bitget futures", () => new BitgetFuturesAdapter("BTCUSDT")],
    ["Bitget spot", () => new BitgetSpotAdapter("BTCUSDT")],
  ])("normalizes %s v2 object trades and skips the snapshot push", (_name, make) => {
    const adapter = make();
    const trades: Array<{ id: string; price: number; quantity: number; side: string }> = [];
    adapter.on("trade", (trade) => trades.push(trade));
    const row = { ts: "1794229976284", price: "74726.9", size: "0.128", side: "sell", tradeId: "1503674994451562496" };
    feed(adapter, { action: "snapshot", arg: { channel: "trade" }, data: [row] });
    expect(trades).toHaveLength(0);
    feed(adapter, { action: "update", arg: { channel: "trade" }, data: [row] });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ price: 74726.9, quantity: 0.128, side: "sell" });
    expect(trades[0].id).toContain("1503674994451562496");
  });

  it("normalizes Coinbase trades", () => {
    expectTrade(new CoinbaseSpotAdapter("BTC-USD"), {
      channel: "market_trades",
      events: [{
        trades: [{
          trade_id: "1",
          product_id: "BTC-USD",
          price: "50000",
          size: "0.01",
          side: "BUY",
          time: "2023-11-14T22:13:20.000Z",
        }],
      }],
    });
  });

  it("normalizes Deribit trades", () => {
    expectTrade(new DeribitAdapter("BTCUSDT"), {
      method: "subscription",
      params: {
        channel: "trades.BTC-PERPETUAL.100ms",
        data: [{
          trade_id: "1",
          instrument_name: "BTC-PERPETUAL",
          price: 50000,
          amount: 100,
          direction: "buy",
          timestamp: 1700000000000,
        }],
      },
    });
  });
});
