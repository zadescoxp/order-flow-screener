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
const polygonSymbol = (symbol: string) => `C:${symbol.replace("/", "-").replace("_", "-").toUpperCase()}`;
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
  "oanda-forex": {
    venue: "oanda-forex",
    assetClass: "forex",
    marketType: "forex",
    websocketUrl: "wss://stream-fxtrade.oanda.com/v3",
    formatSymbol: forexSymbol,
  },
  "polygon-forex": {
    venue: "polygon-forex",
    assetClass: "forex",
    marketType: "forex",
    websocketUrl: "wss://socket.polygon.io/forex",
    formatSymbol: polygonSymbol,
  },
  "finnhub-forex": {
    venue: "finnhub-forex",
    assetClass: "forex",
    marketType: "forex",
    websocketUrl: "wss://ws.finnhub.io",
    formatSymbol: finnhubSymbol,
  },
  "mt5-forex": {
    venue: "mt5-forex",
    assetClass: "forex",
    marketType: "forex",
    websocketUrl: process.env.NEXT_PUBLIC_MT5_WS_URL ?? "ws://127.0.0.1:8765",
    formatSymbol: (symbol) => symbol.replace(/[/_]/g, "").toUpperCase(),
  },
};

export const FOREX_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD"] as const;

export function isForexVenue(venue: Venue): boolean {
  return VENUE_CONFIG[venue]?.assetClass === "forex";
}
