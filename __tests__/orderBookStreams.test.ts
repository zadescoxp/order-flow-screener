import { DeribitAdapter, HyperliquidAdapter, OKXFuturesAdapter, OKXSpotAdapter } from "@/lib/adapters/exchanges";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type { NormalizedOrderBook, VenueConnection } from "@/lib/types/market";
import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";
import { CRYPTO_ASSETS, CRYPTO_SYMBOLS } from "@/lib/config/instruments";

function feed(adapter: BaseExchangeAdapter, payload: unknown): void {
  (adapter as unknown as { handleMessage: (message: unknown) => void }).handleMessage(payload);
}

function capture(adapter: BaseExchangeAdapter) {
  const books: NormalizedOrderBook[] = [];
  const statuses: VenueConnection[] = [];
  adapter.on("orderbook", (book) => books.push(book));
  adapter.on("status", (status) => statuses.push(status));
  return { books, statuses };
}

describe("OKX books channel", () => {
  it.each([
    ["futures", () => new OKXFuturesAdapter("BTCUSDT")],
    ["spot", () => new OKXSpotAdapter("BTCUSDT")],
  ])("applies one-sided %s deltas on top of the snapshot", (_, make) => {
    const adapter = make();
    const { books, statuses } = capture(adapter);
    feed(adapter, {
      arg: { channel: "books" },
      action: "snapshot",
      data: [{ bids: [["100", "2", "0", "1"], ["99", "1", "0", "1"]], asks: [["101", "3", "0", "1"]], ts: "1" }],
    });
    // Update touching only the bid side, including a removal.
    feed(adapter, {
      arg: { channel: "books" },
      action: "update",
      data: [{ bids: [["99", "0", "0", "0"], ["100", "5", "0", "1"]], asks: [], ts: "2" }],
    });
    const last = books.at(-1)!;
    expect(last.bids).toEqual([expect.objectContaining({ price: 100, size: 5 })]);
    expect(last.asks).toEqual([expect.objectContaining({ price: 101, size: 3 })]);
    expect(statuses.some((s) => s.status === "error")).toBe(false);
  });

  it("drops the book and waits for a new snapshot when the seqId chain breaks", () => {
    const adapter = new OKXSpotAdapter("BTCUSDT");
    const { books, statuses } = capture(adapter);
    const row = (bid: string, seqId: number, prevSeqId: number) => ({ bids: [[bid, "1", "0", "1"]], asks: [["101", "1", "0", "1"]], ts: "1", seqId, prevSeqId });
    feed(adapter, { arg: { channel: "books" }, action: "update", data: [row("98", 9, 8)] }); // before any snapshot: ignored
    expect(books).toHaveLength(0);
    feed(adapter, { arg: { channel: "books" }, action: "snapshot", data: [row("100", 10, -1)] });
    feed(adapter, { arg: { channel: "books" }, action: "update", data: [row("99", 11, 10)] });
    expect(books).toHaveLength(2);
    feed(adapter, { arg: { channel: "books" }, action: "update", data: [row("97", 14, 13)] }); // 11 → 13: gap
    expect(statuses.at(-1)?.status).toBe("stale");
    expect(adapter.depthSides()).toBeNull();
    feed(adapter, { arg: { channel: "books" }, action: "update", data: [row("96", 15, 14)] });
    expect(books).toHaveLength(2);
  });
});

describe("Hyperliquid l2Book channel", () => {
  it("reads { px, sz, n } levels as sent on the wire, replacing the book each push", () => {
    const adapter = new HyperliquidAdapter("BTCUSDT");
    const { books } = capture(adapter);
    const push = (bid: string, ask: string) => feed(adapter, { channel: "l2Book", data: { coin: "BTC", time: 1, levels: [[{ px: bid, sz: "2", n: 3 }], [{ px: ask, sz: "1.5", n: 1 }]] } });
    push("100", "101");
    push("99", "100");
    expect(books).toHaveLength(2);
    expect(books[1].bids).toEqual([expect.objectContaining({ price: 99, size: 2 })]);
    expect(books[1].asks).toEqual([expect.objectContaining({ price: 100, size: 1.5 })]);
  });
});

describe("Deribit book channel", () => {
  it("parses grouped [price, amount] snapshots and converts USD size to base units", () => {
    const adapter = new DeribitAdapter("BTCUSDT");
    const { books, statuses } = capture(adapter);
    feed(adapter, {
      method: "subscription",
      params: {
        channel: "book.BTC-PERPETUAL.none.20.100ms",
        data: { bids: [[50000, 100000]], asks: [[50010, 50010]], timestamp: 1, change_id: 1 },
      },
    });
    expect(books).toHaveLength(1);
    expect(books[0].bids[0]).toMatchObject({ price: 50000, size: 2 });
    expect(books[0].asks[0]).toMatchObject({ price: 50010, size: 1 });
    expect(statuses.some((s) => s.status === "error")).toBe(false);
  });

  it("still supports raw [action, price, amount] deltas", () => {
    const adapter = new DeribitAdapter("BTCUSDT");
    const { books } = capture(adapter);
    const channel = "book.BTC-PERPETUAL.raw";
    feed(adapter, { method: "subscription", params: { channel, data: { type: "snapshot", bids: [["new", 100, 1000]], asks: [["new", 101, 1010]] } } });
    feed(adapter, { method: "subscription", params: { channel, data: { type: "change", bids: [["change", 100, 2000]], asks: [] } } });
    expect(books.at(-1)!.bids[0]).toMatchObject({ price: 100, size: 20 });
    expect(books.at(-1)!.asks[0]).toMatchObject({ price: 101, size: 10 });
  });
});

describe("instrument coverage", () => {
  const MAJOR_SPOT = ["binance-spot", "bybit-spot", "okx-spot", "coinbase-spot"];

  it("only lists markets that met the live-activity rule", () => {
    expect(CRYPTO_SYMBOLS.length).toBeGreaterThanOrEqual(100);
    for (const asset of CRYPTO_ASSETS) {
      const symbol = `${asset.base}USDT`;
      const perpVenues = venuesForSelection("all-perps", "perpetual", symbol);
      const spotVenues = venuesForSelection("all-spot", "spot", symbol);
      expect(perpVenues.length + spotVenues.length).toBeGreaterThan(0);
      if (perpVenues.length) expect(perpVenues.filter((v) => v !== "deribit").length).toBeGreaterThanOrEqual(3);
      if (spotVenues.length) expect(spotVenues.filter((v) => MAJOR_SPOT.includes(v)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("offers gold and silver as aggregated perpetuals", () => {
    for (const symbol of ["XAUUSDT", "XAGUSDT"]) {
      expect(venuesForSelection("all-perps", "perpetual", symbol)).toEqual(
        expect.arrayContaining(["binance-futures", "bybit-futures", "okx-futures", "bitget-futures"])
      );
      expect(venuesForSelection("all-spot", "spot", symbol)).toEqual([]);
    }
  });

  it("excludes tokenized stocks and ETFs", () => {
    for (const symbol of ["NVDAUSDT", "QQQUSDT", "TSLAUSDT"]) {
      expect(venueSupports("binance-futures", symbol, "perpetual")).toBe(false);
    }
  });

  it("drops venues that do not list a coin from the aggregate", () => {
    expect(venuesForSelection("all-perps", "perpetual", "SOLUSDT")).not.toContain("deribit");
    expect(venuesForSelection("all-perps", "perpetual", "BTCUSDT")).toContain("deribit");
    expect(venueSupports("coinbase-spot", "TRXUSDT", "spot")).toBe(false);
  });
});
