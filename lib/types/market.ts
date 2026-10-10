// ============================================================
// SHARED MARKET TYPES — Normalized across all exchanges
// ============================================================

export type Venue =
  | "binance-futures"
  | "binance-spot"
  | "bybit-futures"
  | "bybit-spot"
  | "okx-futures"
  | "okx-spot"
  | "bitget-futures"
  | "bitget-spot"
  | "hyperliquid"
  | "deribit"
  | "coinbase-spot";

export type MarketType = "spot" | "perpetual";
export type TradeSide = "buy" | "sell";
export type ConnectionStatus = "connecting" | "live" | "offline" | "error" | "stale";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h";

// ----------------------------------------------------------
// Normalized Trade (from exchange adapter)
// ----------------------------------------------------------
export interface NormalizedTrade {
  id: string;
  venue: Venue;
  symbol: string;
  timestamp: number; // exchange timestamp (ms)
  localTimestamp: number; // local receive timestamp (ms)
  price: number;
  quantity: number; // base asset quantity
  quoteVolume: number; // price * quantity
  side: TradeSide;
  marketType: MarketType;
  sequence?: number;
}

// ----------------------------------------------------------
// Normalized Order Book Entry
// ----------------------------------------------------------
export interface OrderBookLevel {
  price: number;
  size: number;
  venue?: Venue;
}

export interface NormalizedOrderBook {
  venue: Venue;
  symbol: string;
  timestamp: number;
  localTimestamp: number;
  bids: OrderBookLevel[]; // sorted descending
  asks: OrderBookLevel[]; // sorted ascending
  sequence?: number;
}

// ----------------------------------------------------------
// Footprint Price Level
// ----------------------------------------------------------
export interface FootprintLevel {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
  tradeCount: number;
  buyTrades: number;
  sellTrades: number;
  maxTradeSize: number;
  imbalance: "ask" | "bid" | "neutral"; // ask imbalance = ask/bid >= 3x
  isHighVolume: boolean;
  zScore: number;
}

// ----------------------------------------------------------
// Footprint Candle (one time bucket)
// ----------------------------------------------------------
export interface FootprintCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cumulativeDelta: number;
  levels: Map<number, FootprintLevel>; // price -> level
  sortedPrices: number[]; // ascending
  tradeCount: number;
  maxVolumeAtLevel: number;
  complete: boolean;
}

// ----------------------------------------------------------
// Volume Profile
// ----------------------------------------------------------
export interface VolumeProfileLevel {
  price: number;
  totalVolume: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  tradeCount: number;
  isPOC: boolean;
  isVAH: boolean;
  isVAL: boolean;
}

export interface VolumeProfile {
  levels: VolumeProfileLevel[];
  poc: number; // price of control
  vah: number; // value area high
  val: number; // value area low
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

// ----------------------------------------------------------
// OBI — Order Book Imbalance
// ----------------------------------------------------------
export interface OBISnapshot {
  timestamp: number;
  value: number; // -1 to +1
  bidVolume: number;
  askVolume: number;
}

// ----------------------------------------------------------
// Stacked Imbalance
// ----------------------------------------------------------
export interface StackedImbalance {
  direction: "buy" | "sell";
  startPrice: number;
  endPrice: number;
  levels: number; // count of consecutive levels
  candle: FootprintCandle;
}

// ----------------------------------------------------------
// Delta Divergence
// ----------------------------------------------------------
export interface DeltaDivergence {
  type: "price-up-delta-down" | "price-down-delta-up";
  candleIndex: number;
  price: number;
  delta: number;
}

// ----------------------------------------------------------
// Potential Absorption
// ----------------------------------------------------------
export interface AbsorptionEvent {
  timestamp: number;
  price: number;
  side: TradeSide;
  aggressiveVolume: number;
  priceMovement: number;
}

// ----------------------------------------------------------
// Volatility / Z-Score
// ----------------------------------------------------------
export interface ZScorePoint {
  timestamp: number;
  value: number;
  volume: number;
}

// ----------------------------------------------------------
// Connection Status per venue
// ----------------------------------------------------------
export interface VenueConnection {
  venue: Venue;
  status: ConnectionStatus;
  lastHeartbeat: number;
  latencyMs?: number;
  reconnectAttempts: number;
}

// ----------------------------------------------------------
// Aggregated Order Book (multi-venue)
// ----------------------------------------------------------
export interface AggregatedOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  venues: Venue[];
  timestamp: number;
  spread: number;
  spreadPct: number;
  midPrice: number;
}

// ----------------------------------------------------------
// Tool Profile Layout
// ----------------------------------------------------------
export type ToolProfile = "order-flow" | "liquidity" | "volatility";


export interface PanelVisibility {
  volumeProfile: boolean;
  footprint: boolean;
  volatility: boolean;
  depthOfMarket: boolean;
  tradesProfile: boolean;
  obi: boolean;
  orderBook: boolean;
  heatmap: boolean;
}

// ----------------------------------------------------------
// WebSocket Server Message Types (server → client)
// ----------------------------------------------------------
export type WSMessageType =
  | "trade"
  | "orderbook"
  | "footprint_update"
  | "footprint_candle"
  | "connection_status"
  | "obi"
  | "volume_profile"
  | "z_score";

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  data: T;
  timestamp: number;
}

// ----------------------------------------------------------
// Market Ticker
// ----------------------------------------------------------
export interface MarketTicker {
  venue: Venue;
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  timestamp: number;
}
