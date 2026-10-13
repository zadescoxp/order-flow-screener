import type { MarketType, Venue, VenueSelection } from "@/lib/types/market";
import { FOREX_SYMBOLS, isForexVenue } from "@/lib/config/venues";

const PERPETUAL_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT"];
const SPOT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

const VENUE_SYMBOLS: Partial<Record<Venue, readonly string[]>> = {
  deribit: ["BTCUSDT", "ETHUSDT"],
  "coinbase-spot": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
};

const FOREX_VENUES: Venue[] = ["massive-forex", "finnhub-forex", "mt5-forex"];

export function venueSupports(
  venue: Venue,
  symbol: string,
  marketType: MarketType
): boolean {
  const normalized = symbol.toUpperCase();
  if (marketType === "forex") {
    return isForexVenue(venue) && FOREX_SYMBOLS.includes(symbol.replace("_", "/") as typeof FOREX_SYMBOLS[number]);
  }
  if (isForexVenue(venue)) return false;
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
  const venues: Venue[] = marketType === "forex"
    ? FOREX_VENUES
    : marketType === "perpetual"
    ? ["binance-futures", "bybit-futures", "okx-futures", "hyperliquid", "bitget-futures", "deribit"]
    : ["binance-spot", "coinbase-spot", "okx-spot", "bybit-spot", "bitget-spot"];
  if (selection !== "all-perps" && selection !== "all-spot" && selection !== "all-forex") return [selection];
  return venues.filter((venue) => venueSupports(venue, symbol, marketType));
}
