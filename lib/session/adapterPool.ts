import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import { createAdapter } from "@/lib/adapters/exchanges";
import type { MarketType, Venue } from "@/lib/types/market";

interface PooledAdapter {
  adapter: BaseExchangeAdapter;
  references: number;
}

const pool = new Map<string, PooledAdapter>();

function key(venue: Venue, symbol: string, marketType: MarketType): string {
  return `${venue}:${marketType}:${symbol.toUpperCase()}`;
}

export function acquireAdapter(
  venue: Venue,
  symbol: string,
  marketType: MarketType
): BaseExchangeAdapter | null {
  const poolKey = key(venue, symbol, marketType);
  const existing = pool.get(poolKey);
  if (existing) {
    existing.references++;
    return existing.adapter;
  }
  const adapter = createAdapter(venue, symbol);
  if (!adapter) return null;
  pool.set(poolKey, { adapter, references: 1 });
  adapter.connect();
  return adapter;
}

export function releaseAdapter(
  venue: Venue,
  symbol: string,
  marketType: MarketType
): void {
  const poolKey = key(venue, symbol, marketType);
  const pooled = pool.get(poolKey);
  if (!pooled) return;
  pooled.references--;
  if (pooled.references <= 0) {
    pooled.adapter.disconnect();
    pool.delete(poolKey);
  }
}
