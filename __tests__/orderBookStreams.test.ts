import { DeribitAdapter, OKXFuturesAdapter, OKXSpotAdapter } from "@/lib/adapters/exchanges";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import type { NormalizedOrderBook, VenueConnection } from "@/lib/types/market";
import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";
import { CRYPTO_SYMBOLS } from "@/lib/config/instruments";

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
  it("lists the expanded set of perpetuals on the major venues", () => {
    expect(CRYPTO_SYMBOLS.length).toBeGreaterThanOrEqual(25);
    for (const symbol of CRYPTO_SYMBOLS) {
      expect(venueSupports("binance-futures", symbol, "perpetual")).toBe(true);
    }
  });

  it("drops venues that do not list a coin from the aggregate", () => {
    expect(venuesForSelection("all-perps", "perpetual", "SOLUSDT")).not.toContain("deribit");
    expect(venuesForSelection("all-perps", "perpetual", "BTCUSDT")).toContain("deribit");
    expect(venueSupports("coinbase-spot", "TRXUSDT", "spot")).toBe(false);
  });
});
