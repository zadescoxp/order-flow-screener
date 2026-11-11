import type { MarketType, Venue, VenueSelection } from "@/lib/types/market";
import { FOREX_SYMBOLS, isForexVenue } from "@/lib/config/venues";
import { venuesWithData } from "@/lib/config/instruments";

const FOREX_VENUES: Venue[] = ["finnhub-forex"];
const PERP_VENUES: Venue[] = ["binance-futures", "bybit-futures", "okx-futures", "hyperliquid", "bitget-futures", "deribit"];
const SPOT_VENUES: Venue[] = ["binance-spot", "coinbase-spot", "okx-spot", "bybit-spot", "bitget-spot"];

/**
 * True when `venue` has a live market for `symbol`. Crypto and metals come
 * from measured venue activity (see lib/config/coinListings.ts); FX pairs
 * from the verified Finnhub list.
 */
export function venueSupports(venue: Venue, symbol: string, marketType: MarketType): boolean {
  if (marketType === "forex") {
    return isForexVenue(venue) && (FOREX_SYMBOLS as readonly string[]).includes(symbol.replace("_", "/"));
  }
  if (isForexVenue(venue)) return false;
  return venuesWithData(symbol, marketType).includes(venue);
}

export function venuesForSelection(selection: VenueSelection, marketType: MarketType, symbol: string): Venue[] {
  const venues = marketType === "forex" ? FOREX_VENUES : marketType === "perpetual" ? PERP_VENUES : SPOT_VENUES;
  if (selection !== "all-perps" && selection !== "all-spot") return [selection];
  return venues.filter((venue) => venueSupports(venue, symbol, marketType));
}
