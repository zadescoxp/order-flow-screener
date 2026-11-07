import type { MarketType, Venue, VenueSelection } from "@/lib/types/market";
import { FOREX_SYMBOLS, isForexVenue } from "@/lib/config/venues";
import { CRYPTO_SYMBOLS } from "@/lib/config/instruments";

const PERPETUAL_SYMBOLS = CRYPTO_SYMBOLS;
const SPOT_SYMBOLS = CRYPTO_SYMBOLS;

// Per-venue restrictions, from each exchange's public instrument listings.
const VENUE_SYMBOLS: Partial<Record<Venue, readonly string[]>> = {
  // Deribit lists inverse (USD-margined) perpetuals for BTC and ETH only.
  deribit: ["BTCUSDT", "ETHUSDT"],
  "coinbase-spot": CRYPTO_SYMBOLS.filter((symbol) => symbol !== "TRXUSDT"),
};

const FOREX_VENUES: Venue[] = ["finnhub-forex"];

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
  if (selection !== "all-perps" && selection !== "all-spot") return [selection];
  return venues.filter((venue) => venueSupports(venue, symbol, marketType));
}
