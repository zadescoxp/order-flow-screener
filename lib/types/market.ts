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
  | "coinbase-spot"
  | "finnhub-forex";
export type VenueSelection = Venue | "all-perps" | "all-spot";

export type MarketType = "spot" | "perpetual" | "forex";
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
// Normalized Liquidation (forced close of a derivatives position)
// `side` is the position that was liquidated: a long liquidation is
// executed as a forced sell, a short liquidation as a forced buy.
// ----------------------------------------------------------
export type LiquidationSide = "long" | "short";

export interface NormalizedLiquidation {
  id: string;
  venue: Venue;
  symbol: string;
  timestamp: number;
  localTimestamp: number;
  price: number;
  quantity: number; // base asset quantity
  quoteVolume: number; // price * quantity
  side: LiquidationSide;
}

// ----------------------------------------------------------
// Derivatives state (perpetuals): open interest, funding, mark/index.
// Adapters emit partial updates; the manager merges them per venue.
// ----------------------------------------------------------
export interface DerivativesSnapshot {
  venue: Venue;
  timestamp: number;
  openInterest?: number; // base asset units
  fundingRate?: number; // decimal rate per funding interval (0.0001 = 0.01%)
  fundingIntervalHours?: number;
  nextFundingTime?: number; // ms
  markPrice?: number;
  indexPrice?: number;
}

export interface DerivativesAggregate {
  timestamp: number;
  venues: DerivativesSnapshot[];
  openInterest: number | null; // base units, summed over reporting venues
  openInterestValue: number | null; // quote units
  fundingRate8h: number | null; // OI-weighted, normalized to an 8h interval
  nextFundingTime: number | null; // primary venue
  fundingIntervalHours: number | null; // primary venue
  primaryFundingRate: number | null; // primary venue, native interval
  markPrice: number | null;
  indexPrice: number | null;
  basisBps: number | null; // (mark − index) / index in basis points
}

export interface OpenInterestPoint {
  time: number; // second bucket (ms)
  openInterest: number; // base units
  price: number;
}

/** A print at least N× the session's average print size. */
export interface BigTrade extends NormalizedTrade {
  ratio: number; // quantity / session average print at the time
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

export interface HeatmapSettings {
  tradedVolume: boolean;
  restingLiquidity: boolean; // order-book depth over time behind the footprint
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
  vwap?: number; // session VWAP at the latest trade in this candle
  vwapStd?: number; // volume-weighted σ of session prices at that point
  venueVolumes: Partial<Record<Venue, number>>;
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
// Flow bar — fixed 1-second time bucket of executed flow.
// Source series for volume z-score, realized volatility and CVD.
// ----------------------------------------------------------
export interface FlowBar {
  time: number; // bucket open (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  trades: number;
  cvd: number; // session cumulative delta at bar close
}

// ----------------------------------------------------------
// Session statistics (since the feed connected)
// ----------------------------------------------------------
export interface SessionStats {
  startTime: number;
  open: number;
  high: number;
  low: number;
  last: number;
  volume: number;
  notional: number;
  buyVolume: number;
  sellVolume: number;
  trades: number;
  maxTrade: number;
  vwap: number;
  vwapStd: number;
  sumPQ: number;
  sumP2Q: number;
  lastTradeLagMs: number;
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
  error?: string;
  stateFlag?: string;
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
  footprint: boolean;
  volumeProfile: boolean; // session profile attached to the footprint
  heatmap: boolean; // traded-volume heatmap behind the footprint
  orderBook: boolean;
  obi: boolean;
  timeSales: boolean;
  cvd: boolean;
  volumeZ: boolean;
  volatility: boolean;
  depthOfMarket: boolean;
  liquidations: boolean; // perpetuals only
  openInterest: boolean; // perpetuals only
  venues: boolean; // cross-venue comparison (multi-venue selections)
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
  | "volume_profile";

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
