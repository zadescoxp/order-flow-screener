import type { MarketType, Venue, VenueSelection } from "@/lib/types/market";

const PERPETUAL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT"];
const SPOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

const VENUE_SYMBOLS: Partial<Record<Venue, readonly string[]>> = {
  deribit: ["BTCUSDT", "ETHUSDT"],
  "coinbase-spot": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
};

export function venueSupports(
  venue: Venue,
  symbol: string,
  marketType: MarketType
): boolean {
  const normalized = symbol.toUpperCase();
  const allowed = VENUE_SYMBOLS[venue];
  if (allowed && !allowed.includes(normalized)) return false;
  if (marketType === "perpetual" && venue.includes("spot")) return false;
  if (marketType === "spot" && (venue.includes("futures") || venue === "hyperliquid" || venue === "deribit")) return false;
  if (marketType === "perpetual" && !PERPETUAL_SYMBOLS.includes(normalized)) return false;
  if (marketType === "spot" && !SPOT_SYMBOLS.includes(normalized)) return false;
  return true;
}

export function venuesForSelection(
  selection: VenueSelection,
  marketType: MarketType,
  symbol: string
): Venue[] {
  const venues: Venue[] = marketType === "perpetual"
    ? ["binance-futures", "bybit-futures", "okx-futures", "hyperliquid", "bitget-futures", "deribit"]
    : ["binance-spot", "coinbase-spot", "okx-spot", "bybit-spot", "bitget-spot"];
  if (selection !== "all-perps" && selection !== "all-spot") return [selection];
  return venues.filter((venue) => venueSupports(venue, symbol, marketType));
}
