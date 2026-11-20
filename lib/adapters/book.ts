// Shared order-book helpers for exchange adapters.

import type { BaseExchangeAdapter } from "./base";
import type { NormalizedOrderBook, OrderBookLevel, Venue } from "@/lib/types/market";

/** Apply [price, size, ...] deltas to a book side; a size of 0 removes the level. */
export function applyLevels(side: Map<number, number>, levels: ReadonlyArray<ReadonlyArray<string>>, multiplier: number) {
  for (const level of levels) {
    const price = parseFloat(level[0]);
    const qty = parseFloat(level[1]) * multiplier;
    if (!Number.isFinite(price)) continue;
    if (!(qty > 0)) side.delete(price);
    else side.set(price, qty);
  }
}
/** Bitget v2 trades are objects; older payloads were [ts, price, size, side, tradeId] arrays. */
export function parseBitgetTrades(data: unknown[]): { ts: string; price: string; size: string; side: string; tradeId: string }[] {
  return data.map((t) => {
    if (Array.isArray(t)) {
      const [ts, price, size, side, tradeId] = t as string[];
      return { ts, price, size, side, tradeId: tradeId ?? ts };
    }
    const o = t as { ts: string; price: string; size: string; side: string; tradeId?: string };
    return { ...o, tradeId: o.tradeId ?? o.ts };
  });
}

/** Levels kept per side. Deep enough for the resting-liquidity heatmap. */
export const BOOK_DEPTH = 200;

export function emitBook(
  adapter: BaseExchangeAdapter & { venue: Venue; symbol: string },
  bidsMap: Map<number, number>,
  asksMap: Map<number, number>,
  emitFn: (book: NormalizedOrderBook) => void
) {
  const bids: OrderBookLevel[] = [...bidsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, BOOK_DEPTH)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  const asks: OrderBookLevel[] = [...asksMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, BOOK_DEPTH)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  emitFn({ venue: adapter.venue, symbol: adapter.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks });
}
