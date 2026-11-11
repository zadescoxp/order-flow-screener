import type { MarketType, Venue } from "@/lib/types/market";

export type AssetClass = "crypto" | "forex";

export interface VenueConfig {
  venue: Venue;
  assetClass: AssetClass;
  marketType: MarketType;
  websocketUrl: string;
  formatSymbol: (symbol: string) => string;
}

const forexSymbol = (symbol: string) => symbol.replace("/", "_").toUpperCase();
const finnhubSymbol = (symbol: string) => `OANDA:${forexSymbol(symbol)}`;

export const VENUE_CONFIG: Record<Venue, VenueConfig | undefined> = {
  "binance-futures": undefined,
  "binance-spot": undefined,
  "bybit-futures": undefined,
  "bybit-spot": undefined,
  "okx-futures": undefined,
  "okx-spot": undefined,
  "bitget-futures": undefined,
  "bitget-spot": undefined,
  hyperliquid: undefined,
  deribit: undefined,
  "coinbase-spot": undefined,
  "finnhub-forex": {
    venue: "finnhub-forex",
    assetClass: "forex",
    marketType: "forex",
    websocketUrl: "wss://ws.finnhub.io",
    formatSymbol: finnhubSymbol,
  },
};

// Pairs the Finnhub (OANDA) stream was observed sending ticks for, majors
// first. Gold and silver are served as perpetuals instead (see METALS in
// lib/config/instruments.ts): their Finnhub ticks are too sparse for order flow.
export const FOREX_SYMBOLS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD",
  "AUD/JPY", "NZD/JPY", "GBP/CHF", "SGD/CHF", "EUR/NOK", "EUR/TRY", "GBP/HKD", "NZD/HKD",
  "USD/NOK", "USD/DKK", "USD/SGD", "USD/PLN", "USD/CZK",
] as const;

const MAJORS = new Set(["EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD"]);

/** Picker grouping for FX pairs. */
export const FOREX_GROUPS: Record<string, "Majors" | "Crosses"> = Object.fromEntries(
  FOREX_SYMBOLS.map((pair) => [pair, MAJORS.has(pair) ? "Majors" : "Crosses"])
);

export function isForexVenue(venue: Venue): boolean {
  return VENUE_CONFIG[venue]?.assetClass === "forex";
}
