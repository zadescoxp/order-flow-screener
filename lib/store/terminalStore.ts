// ============================================================
// ZUSTAND STORE — Terminal UI State + Market Data State
// ============================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { type Theme, applyTheme } from "@/lib/theme";
import type {
  Venue,
  VenueSelection,
  MarketType,
  Timeframe,
  ToolProfile,
  PanelVisibility,
  NormalizedTrade,
  NormalizedOrderBook,
  AggregatedOrderBook,
  FootprintCandle,
  VolumeProfile,
  OBISnapshot,
  ZScorePoint,
  VenueConnection,
  MarketTicker,
} from "@/lib/types/market";
import { RingBuffer } from "@/lib/session/RingBuffer";
import { isForexVenue } from "@/lib/config/venues";

// ----------------------------------------------------------
// Terminal Settings
// ----------------------------------------------------------
export interface TerminalSettings {
  symbol: string;
  venue: VenueSelection;
  selectedVenues: Venue[];
  marketType: MarketType;
  timeframe: Timeframe;
  toolProfile: ToolProfile;
  tickSize: number;
  imbalanceThreshold: number;
  stackedImbalanceLevels: number;
  zScoreWindow: number;
  orderBookMode: "single" | "aggregated" | "compact";
  panels: PanelVisibility;
  theme: Theme;
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
  zScoreHistory: ZScorePoint[];
  connections: Record<string, VenueConnection>;
  ticker: MarketTicker | null;
  crosshairTime: number | null;
  crosshairPrice: number | null;
  cumulativeDelta: number;
}

// ----------------------------------------------------------
// Actions
// ----------------------------------------------------------
export interface TerminalActions {
  // Settings
  setSymbol: (s: string) => void;
  setVenue: (v: VenueSelection) => void;
  setSelectedVenues: (venues: Venue[]) => void;
  setMarketType: (m: MarketType) => void;
  setTimeframe: (t: Timeframe) => void;
  setToolProfile: (tp: ToolProfile) => void;
  setTickSize: (ts: number) => void;
  setImbalanceThreshold: (t: number) => void;
  setOrderBookMode: (m: "single" | "aggregated" | "compact") => void;
  setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => void;
  setTheme: (theme: Theme) => void;

  // Market data mutations
  pushTrade: (trade: NormalizedTrade) => void;
  updateOrderBook: (book: NormalizedOrderBook) => void;
  updateAggregatedBook: (book: AggregatedOrderBook | null) => void;
  updateCurrentCandle: (candle: FootprintCandle) => void;
  finalizeCandle: (candle: FootprintCandle) => void;
  setVolumeProfile: (vp: VolumeProfile) => void;
  pushOBI: (snap: OBISnapshot) => void;
  pushZScore: (z: ZScorePoint) => void;
  updateConnection: (conn: VenueConnection) => void;
  updateTicker: (t: MarketTicker) => void;
  applyMarketDataBatch: (batch: MarketDataBatch) => void;
  setCrosshair: (time: number | null, price: number | null) => void;
  resetMarketData: () => void;
}

export type TerminalStore = TerminalSettings & MarketDataState & TerminalActions;

export interface MarketDataBatch {
  trades: NormalizedTrade[];
  orderBook: NormalizedOrderBook | null;
  aggregatedBook: AggregatedOrderBook | null;
  candle: FootprintCandle | null;
  volumeProfile: VolumeProfile | null;
  ticker: MarketTicker | null;
  obi: OBISnapshot | null;
  zScores: ZScorePoint[];
  connections: VenueConnection[];
}

// ----------------------------------------------------------
// Default panel visibility per tool profile
// ----------------------------------------------------------
const PROFILE_PANELS: Record<ToolProfile, PanelVisibility> = {
  "order-flow": {
    volumeProfile: true,
    footprint: true,
    volatility: false,
    depthOfMarket: true,
    tradesProfile: true,
    obi: true,
    orderBook: true,
    heatmap: false,
  },
  liquidity: {
    volumeProfile: false,
    footprint: true,
    volatility: false,
    depthOfMarket: true,
    tradesProfile: false,
    obi: true,
    orderBook: true,
    heatmap: true,
  },
  volatility: {
    volumeProfile: true,
    footprint: true,
    volatility: true,
    depthOfMarket: false,
    tradesProfile: false,
    obi: false,
    orderBook: false,
    heatmap: true,
  },
};

const INITIAL_SETTINGS: TerminalSettings = {
  symbol: "BTCUSDT",
  venue: "bybit-futures",
  selectedVenues: ["bybit-futures"],
  marketType: "perpetual",
  timeframe: "5m",
  toolProfile: "order-flow",
  tickSize: 10,
  imbalanceThreshold: 3,
  stackedImbalanceLevels: 3,
  zScoreWindow: 20,
  orderBookMode: "single",
  panels: PROFILE_PANELS["order-flow"],
  theme: "dark",
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
  zScoreHistory: [],
  connections: {},
  ticker: null,
  crosshairTime: null,
  crosshairPrice: null,
  cumulativeDelta: 0,
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

    // --- Settings ---
    setSymbol: (symbol) =>
      set((s) => ({ symbol, ...INITIAL_MARKET })),

    setVenue: (venue) =>
      set((s) => ({
        venue,
        selectedVenues:
          venue === "all-perps" || venue === "all-spot" || venue === "all-forex"
            ? s.selectedVenues
            : [venue],
        ...INITIAL_MARKET,
      })),

    setSelectedVenues: (selectedVenues) =>
      set({ selectedVenues, ...INITIAL_MARKET }),

    setMarketType: (marketType) =>
      set((s) => {
        const isValidVenue = marketType === "forex"
          ? isForexVenue(s.venue as Venue)
          : marketType === "perpetual"
          ? s.venue.includes("futures") || s.venue === "hyperliquid" || s.venue === "deribit"
          : s.venue.includes("spot");
        const newVenue = isValidVenue 
          ? s.venue 
          : (marketType === "forex" ? "massive-forex" : marketType === "perpetual" ? "bybit-futures" : "bybit-spot");
        return {
          marketType,
          venue: newVenue as VenueSelection,
          selectedVenues: newVenue === "all-forex"
            ? ["massive-forex", "finnhub-forex", "mt5-forex"]
            : [newVenue as Venue],
          tickSize: marketType === "forex" ? 0.00001 : s.tickSize,
          ...INITIAL_MARKET,
        };
      }),

    setTimeframe: (timeframe) =>
      set({ timeframe, ...INITIAL_MARKET }),

    setToolProfile: (toolProfile) =>
      set({ toolProfile, panels: PROFILE_PANELS[toolProfile] }),

    setTickSize: (tickSize) => set({ tickSize }),

    setImbalanceThreshold: (imbalanceThreshold) =>
      set({ imbalanceThreshold }),

    setOrderBookMode: (orderBookMode) => set({ orderBookMode }),

    setPanelVisible: (panel, visible) =>
      set((s) => ({
        panels: { ...s.panels, [panel]: visible },
      })),

    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },

    // --- Market Data ---
    pushTrade: (trade) =>
      set(() => {
        recentTradeBuffer.push(trade);
        return { recentTrades: recentTradeBuffer.newestFirst() };
      }),

    updateOrderBook: (book) =>
      set({ orderBook: book }),

    updateAggregatedBook: (aggregatedBook) =>
      set({ aggregatedBook }),

    updateCurrentCandle: (candle) =>
      set({ currentCandle: candle }),

    finalizeCandle: (candle) =>
      set((s) => ({
        candles: [...s.candles, { ...candle, complete: true }].slice(-500),
        currentCandle: null,
      })),

    setVolumeProfile: (vp) => set({ volumeProfile: vp }),

    pushOBI: (snap) =>
      set((s) => ({
        currentOBI: snap.value,
        obiHistory: [...s.obiHistory, snap].slice(-300),
      })),

    pushZScore: (z) =>
      set((s) => ({
        zScoreHistory: [...s.zScoreHistory, z].slice(-500),
      })),

    updateConnection: (conn) =>
      set((s) => ({
        connections: { ...s.connections, [conn.venue]: conn },
      })),

    updateTicker: (ticker) => set({ ticker }),

    applyMarketDataBatch: (batch) =>
      set((s) => {
        for (const trade of batch.trades) recentTradeBuffer.push(trade);
        return {
          recentTrades: batch.trades.length
            ? recentTradeBuffer.newestFirst()
            : s.recentTrades,
          orderBook: batch.orderBook ?? s.orderBook,
          aggregatedBook: batch.aggregatedBook ?? s.aggregatedBook,
          currentCandle: batch.candle ?? s.currentCandle,
          volumeProfile: batch.volumeProfile ?? s.volumeProfile,
          ticker: batch.ticker ?? s.ticker,
          currentOBI: batch.obi?.value ?? s.currentOBI,
          obiHistory: batch.obi
            ? [...s.obiHistory, batch.obi].slice(-300)
            : s.obiHistory,
          zScoreHistory: batch.zScores.length
            ? [...s.zScoreHistory, ...batch.zScores].slice(-500)
            : s.zScoreHistory,
          connections: batch.connections.length
            ? {
                ...s.connections,
                ...Object.fromEntries(batch.connections.map((connection) => [connection.venue, connection])),
              }
            : s.connections,
        };
      }),

    setCrosshair: (crosshairTime, crosshairPrice) =>
      set({ crosshairTime, crosshairPrice }),

    resetMarketData: () => {
      recentTradeBuffer.clear();
      set(INITIAL_MARKET);
    },
  }))
  );
};
