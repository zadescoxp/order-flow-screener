// ============================================================
// ZUSTAND STORE — Per-session market settings + market data
// UI preferences (theme, panels, profiles) live in uiStore.
// ============================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Venue,
  VenueSelection,
  MarketType,
  Timeframe,
  NormalizedTrade,
  NormalizedOrderBook,
  AggregatedOrderBook,
  FootprintCandle,
  VolumeProfile,
  OBISnapshot,
  FlowBar,
  SessionStats,
  VenueConnection,
  MarketTicker,
  NormalizedLiquidation,
  DerivativesAggregate,
  OpenInterestPoint,
  BigTrade,
} from "@/lib/types/market";
import type { MicroEvent } from "@/lib/engine/microstructure";
import type { VenueBucket } from "@/lib/engine/venues";
import type { RecordingStatus, ReplayStatus } from "@/lib/recording/types";
import { RingBuffer } from "@/lib/session/RingBuffer";
import { isForexVenue } from "@/lib/config/venues";

export type OrderBookMode = "single" | "aggregated" | "compact";

// ----------------------------------------------------------
// Terminal Settings
// ----------------------------------------------------------
export interface TerminalSettings {
  symbol: string;
  venue: VenueSelection;
  selectedVenues: Venue[];
  marketType: MarketType;
  timeframe: Timeframe;
  tickSize: number;
  imbalanceThreshold: number;
  stackedImbalanceLevels: number;
  orderBookMode: OrderBookMode;
  valueAreaPct: number;
}

// ----------------------------------------------------------
// Market Data State
// ----------------------------------------------------------
export interface MarketDataState {
  candles: FootprintCandle[];
  currentCandle: FootprintCandle | null;
  volumeProfile: VolumeProfile | null;
  recentTrades: NormalizedTrade[];
  orderBook: NormalizedOrderBook | null;
  aggregatedBook: AggregatedOrderBook | null;
  obiHistory: OBISnapshot[];
  currentOBI: number;
  flowBars: FlowBar[]; // completed 1-second bars
  liveBar: FlowBar | null; // bar still being built
  session: SessionStats | null;
  connections: Record<string, VenueConnection>;
  ticker: MarketTicker | null;
  liquidations: NormalizedLiquidation[]; // oldest first
  derivatives: DerivativesAggregate | null;
  oiHistory: OpenInterestPoint[]; // 1-second samples of total open interest
  bigTrades: BigTrade[]; // oldest first; prints ≥ BIG_TRADE_MIN_RATIO × average
  marketClock: number; // wall time when live, virtual time during replay
  depthVersion: number; // bumps when the manager's depth history gains a snapshot
  microEvents: MicroEvent[]; // absorption / iceberg detections, oldest first
  venueBuckets: Partial<Record<Venue, VenueBucket[]>>; // per-venue 250 ms buckets
  crosshairTime: number | null;
  crosshairPrice: number | null;
}

// ----------------------------------------------------------
// Actions
// ----------------------------------------------------------
export interface TerminalActions {
  setSymbol: (s: string) => void;
  setVenue: (v: VenueSelection) => void;
  setSelectedVenues: (venues: Venue[]) => void;
  setMarketType: (m: MarketType) => void;
  setTimeframe: (t: Timeframe) => void;
  setTickSize: (ts: number) => void;
  setImbalanceThreshold: (t: number) => void;
  setOrderBookMode: (m: OrderBookMode) => void;
  setValueAreaPct: (pct: number) => void;

  finalizeCandle: (candle: FootprintCandle) => void;
  updateConnection: (conn: VenueConnection) => void;
  applyMarketDataBatch: (batch: MarketDataBatch) => void;
  setCrosshair: (time: number | null, price: number | null) => void;
  resetMarketData: () => void;
}

/** Recording / replay state; deliberately not part of the market-data reset. */
export interface SessionModeState {
  recording: RecordingStatus | null;
  replay: ReplayStatus | null;
}

export type TerminalStore = TerminalSettings & MarketDataState & TerminalActions & SessionModeState;

export interface MarketDataBatch {
  trades: NormalizedTrade[];
  orderBook: NormalizedOrderBook | null;
  aggregatedBook: AggregatedOrderBook | null;
  candle: FootprintCandle | null;
  volumeProfile: VolumeProfile | null;
  ticker: MarketTicker | null;
  obi: OBISnapshot | null;
  flowBars: FlowBar[];
  liveBar: FlowBar | null;
  session: SessionStats | null;
  connections: VenueConnection[];
  liquidations: NormalizedLiquidation[];
  derivatives: DerivativesAggregate | null;
  oiPoints: OpenInterestPoint[];
  bigTrades: BigTrade[];
  clock: number;
  depthVersion: number; // 0 = unchanged
  microEvents: MicroEvent[];
  venueBuckets: Partial<Record<Venue, VenueBucket[]>> | null;
}

export const MAX_FLOW_BARS = 7200; // two hours of 1-second bars
const MAX_CANDLES = 500;
const MAX_OBI_POINTS = 600;
export const MAX_LIQUIDATIONS = 5000;
export const MAX_OI_POINTS = 7200; // two hours of 1-second samples
export const MAX_BIG_TRADES = 3000;
export const MAX_MICRO_EVENTS = 500;

const INITIAL_SETTINGS: TerminalSettings = {
  symbol: "BTCUSDT",
  venue: "bybit-futures",
  selectedVenues: ["bybit-futures"],
  marketType: "perpetual",
  timeframe: "5m",
  tickSize: 10,
  imbalanceThreshold: 3,
  stackedImbalanceLevels: 3,
  orderBookMode: "single",
  valueAreaPct: 0.7,
};

const INITIAL_MARKET: MarketDataState = {
  candles: [],
  currentCandle: null,
  volumeProfile: null,
  recentTrades: [],
  orderBook: null,
  aggregatedBook: null,
  obiHistory: [],
  currentOBI: 0,
  flowBars: [],
  liveBar: null,
  session: null,
  connections: {},
  ticker: null,
  liquidations: [],
  derivatives: null,
  oiHistory: [],
  bigTrades: [],
  marketClock: 0,
  depthVersion: 0,
  microEvents: [],
  venueBuckets: {},
  crosshairTime: null,
  crosshairPrice: null,
};

// ----------------------------------------------------------
// Create the store
// ----------------------------------------------------------
export const createTerminalStore = () => {
  const recentTradeBuffer = new RingBuffer<NormalizedTrade>(500);
  return create<TerminalStore>()(
    subscribeWithSelector((set) => ({
      ...INITIAL_SETTINGS,
      ...INITIAL_MARKET,
      recording: null,
      replay: null,

      setSymbol: (symbol) => set({ symbol, ...INITIAL_MARKET }),

      setVenue: (venue) =>
        set((s) => ({
          venue,
          selectedVenues:
            venue === "all-perps" || venue === "all-spot" ? s.selectedVenues : [venue],
          orderBookMode: venue === "all-perps" || venue === "all-spot" ? "aggregated" : "single",
          ...INITIAL_MARKET,
        })),

      setSelectedVenues: (selectedVenues) => set({ selectedVenues, ...INITIAL_MARKET }),

      setMarketType: (marketType) =>
        set((s) => {
          const isValidVenue =
            marketType === "forex"
              ? isForexVenue(s.venue as Venue)
              : marketType === "perpetual"
                ? s.venue.includes("futures") || s.venue === "hyperliquid" || s.venue === "deribit" || s.venue === "all-perps"
                : s.venue.includes("spot");
          const newVenue = isValidVenue
            ? s.venue
            : marketType === "forex"
              ? "finnhub-forex"
              : marketType === "perpetual"
                ? "bybit-futures"
                : "bybit-spot";
          return {
            marketType,
            venue: newVenue as VenueSelection,
            selectedVenues: isValidVenue ? s.selectedVenues : [newVenue as Venue],
            orderBookMode: isValidVenue ? s.orderBookMode : "single",
            ...INITIAL_MARKET,
          };
        }),

      setTimeframe: (timeframe) => set({ timeframe, ...INITIAL_MARKET }),

      setTickSize: (tickSize) => set({ tickSize }),

      setImbalanceThreshold: (imbalanceThreshold) => set({ imbalanceThreshold }),

      setOrderBookMode: (orderBookMode) => set({ orderBookMode }),

      setValueAreaPct: (valueAreaPct) => set({ valueAreaPct }),

      finalizeCandle: (candle) =>
        set((s) => ({
          candles: [...s.candles, { ...candle, complete: true }].slice(-MAX_CANDLES),
          currentCandle: null,
        })),

      updateConnection: (conn) =>
        set((s) => ({ connections: { ...s.connections, [conn.venue]: conn } })),

      applyMarketDataBatch: (batch) =>
        set((s) => {
          for (const trade of batch.trades) recentTradeBuffer.push(trade);
          return {
            recentTrades: batch.trades.length ? recentTradeBuffer.newestFirst() : s.recentTrades,
            orderBook: batch.orderBook ?? s.orderBook,
            aggregatedBook: batch.aggregatedBook ?? s.aggregatedBook,
            currentCandle: batch.candle ?? s.currentCandle,
            volumeProfile: batch.volumeProfile ?? s.volumeProfile,
            ticker: batch.ticker ?? s.ticker,
            currentOBI: batch.obi?.value ?? s.currentOBI,
            obiHistory: batch.obi ? [...s.obiHistory, batch.obi].slice(-MAX_OBI_POINTS) : s.obiHistory,
            flowBars: batch.flowBars.length
              ? [...s.flowBars, ...batch.flowBars].slice(-MAX_FLOW_BARS)
              : s.flowBars,
            liveBar: batch.liveBar ?? s.liveBar,
            session: batch.session ?? s.session,
            liquidations: batch.liquidations.length
              ? [...s.liquidations, ...batch.liquidations].slice(-MAX_LIQUIDATIONS)
              : s.liquidations,
            derivatives: batch.derivatives ?? s.derivatives,
            oiHistory: batch.oiPoints.length
              ? [...s.oiHistory, ...batch.oiPoints].slice(-MAX_OI_POINTS)
              : s.oiHistory,
            bigTrades: batch.bigTrades.length
              ? [...s.bigTrades, ...batch.bigTrades].slice(-MAX_BIG_TRADES)
              : s.bigTrades,
            marketClock: batch.clock || s.marketClock,
            depthVersion: batch.depthVersion || s.depthVersion,
            microEvents: batch.microEvents.length
              ? [...s.microEvents, ...batch.microEvents].slice(-MAX_MICRO_EVENTS)
              : s.microEvents,
            venueBuckets: batch.venueBuckets ?? s.venueBuckets,
            connections: batch.connections.length
              ? {
                  ...s.connections,
                  ...Object.fromEntries(batch.connections.map((c) => [c.venue, c])),
                }
              : s.connections,
          };
        }),

      setCrosshair: (crosshairTime, crosshairPrice) => set({ crosshairTime, crosshairPrice }),

      resetMarketData: () => {
        recentTradeBuffer.clear();
        set(INITIAL_MARKET);
      },
    }))
  );
};
