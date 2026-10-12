import { aggregateBooks, computeBandObi } from "@/lib/aggregation/marketAggregation";
import type { NormalizedOrderBook } from "@/lib/types/market";

const book = (
  venue: NormalizedOrderBook["venue"],
  bids: [number, number][],
  asks: [number, number][]
): NormalizedOrderBook => ({
  venue,
  symbol: "BTCUSDT",
  timestamp: 1,
  localTimestamp: 1,
  bids: bids.map(([price, size]) => ({ price, size })),
  asks: asks.map(([price, size]) => ({ price, size })),
});

describe("market aggregation", () => {
  it("sums books by price and preserves crossed markets", () => {
    const aggregate = aggregateBooks(new Map([
      ["binance-futures", book("binance-futures", [[101, 2]], [[99, 3]])],
      ["bybit-futures", book("bybit-futures", [[101, 4]], [[100, 5]])],
    ]));
    expect(aggregate?.bids[0]).toMatchObject({ price: 101, size: 6 });
    expect(aggregate?.asks[0]).toMatchObject({ price: 99, size: 3 });
    expect(aggregate?.spread).toBe(-2);
  });

  it("limits OBI to the shallowest venue coverage band", () => {
    const books = new Map([
      ["binance-futures", book("binance-futures", [[99, 2], [98, 100]], [[101, 3], [102, 100]])],
      ["bybit-futures", book("bybit-futures", [[99, 5]], [[101, 7]])],
    ] as const);
    expect(computeBandObi(books, aggregateBooks(books)!)).toEqual({
      bidVolume: 7,
      askVolume: 10,
    });
  });
});
