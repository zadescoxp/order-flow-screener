// ============================================================
// ZUSTAND STORE — Terminal UI State + Market Data State
// ============================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { type Theme, applyTheme } from "@/lib/theme";
import type {
  Venue,
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
  OrderBookLevel,
} from "@/lib/types/market";

// ----------------------------------------------------------
// Terminal Settings
// ----------------------------------------------------------
export interface TerminalSettings {
  symbol: string;
  venue: Venue;
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
  setVenue: (v: Venue) => void;
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
  updateCurrentCandle: (candle: FootprintCandle) => void;
  finalizeCandle: (candle: FootprintCandle) => void;
  setVolumeProfile: (vp: VolumeProfile) => void;
  pushOBI: (snap: OBISnapshot) => void;
  pushZScore: (z: ZScorePoint) => void;
  updateConnection: (conn: VenueConnection) => void;
  updateTicker: (t: MarketTicker) => void;
  setCrosshair: (time: number | null, price: number | null) => void;
  resetMarketData: () => void;
}

type TerminalStore = TerminalSettings & MarketDataState & TerminalActions;

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
export const useTerminalStore = create<TerminalStore>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_SETTINGS,
    ...INITIAL_MARKET,

    // --- Settings ---
    setSymbol: (symbol) =>
      set((s) => ({ symbol, ...INITIAL_MARKET })),

    setVenue: (venue) =>
      set({ venue, ...INITIAL_MARKET }),

    setMarketType: (marketType) =>
      set((s) => {
        const isValidVenue = marketType === "perpetual" 
          ? s.venue.includes("futures") || s.venue === "hyperliquid" || s.venue === "deribit"
          : s.venue.includes("spot");
        const newVenue = isValidVenue 
          ? s.venue 
          : (marketType === "perpetual" ? "bybit-futures" : "bybit-spot");
        return { marketType, venue: newVenue as Venue, ...INITIAL_MARKET };
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
      set((s) => ({
        recentTrades: [trade, ...s.recentTrades].slice(0, 500),
      })),

    updateOrderBook: (book) =>
      set({ orderBook: book }),

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

    setCrosshair: (crosshairTime, crosshairPrice) =>
      set({ crosshairTime, crosshairPrice }),

    resetMarketData: () => set(INITIAL_MARKET),
  }))
);
