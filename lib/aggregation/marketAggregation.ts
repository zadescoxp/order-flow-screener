import type {
  AggregatedOrderBook,
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";

export function aggregateBooks(
  books: Map<Venue, NormalizedOrderBook>
): AggregatedOrderBook | null {
  if (books.size === 0) return null;
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();
  const venues = [...books.keys()];
  for (const book of books.values()) {
    for (const level of book.bids) bidMap.set(level.price, (bidMap.get(level.price) ?? 0) + level.size);
    for (const level of book.asks) askMap.set(level.price, (askMap.get(level.price) ?? 0) + level.size);
  }
  const bids = toLevels(bidMap, "desc", venues);
  const asks = toLevels(askMap, "asc", venues);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  return {
    bids,
    asks,
    venues,
    timestamp: Math.max(...[...books.values()].map((book) => book.timestamp)),
    spread,
    spreadPct: midPrice ? (spread / midPrice) * 100 : 0,
    midPrice,
  };
}

function toLevels(
  levels: Map<number, number>,
  direction: "asc" | "desc",
  venues: Venue[]
): OrderBookLevel[] {
  return [...levels.entries()]
    .sort((a, b) => direction === "desc" ? b[0] - a[0] : a[0] - b[0])
    .slice(0, 100)
    .map(([price, size]) => ({ price, size, venue: venues.length === 1 ? venues[0] : undefined }));
}

export function computeBandObi(
  books: Map<Venue, NormalizedOrderBook>,
  aggregate: AggregatedOrderBook
): { bidVolume: number; askVolume: number } {
  if (!aggregate.midPrice || books.size === 0) return { bidVolume: 0, askVolume: 0 };
  const coverage = [...books.values()].map((book) => {
    const distances = [
      ...book.bids.map((level) => Math.abs(level.price - aggregate.midPrice)),
      ...book.asks.map((level) => Math.abs(level.price - aggregate.midPrice)),
    ];
    return distances.length ? Math.max(...distances) : 0;
  });
  const band = Math.min(...coverage);
  return {
    bidVolume: aggregate.bids
      .filter((level) => aggregate.midPrice - level.price <= band)
      .reduce((sum, level) => sum + level.size, 0),
    askVolume: aggregate.asks
      .filter((level) => level.price - aggregate.midPrice <= band)
      .reduce((sum, level) => sum + level.size, 0),
  };
}
