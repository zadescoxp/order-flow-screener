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

export const FOREX_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"] as const;

export function isForexVenue(venue: Venue): boolean {
  return VENUE_CONFIG[venue]?.assetClass === "forex";
}
