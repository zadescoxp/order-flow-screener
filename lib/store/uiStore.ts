import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { applyTheme, type Theme } from "@/lib/theme";
import type { HeatmapSettings, PanelVisibility, ToolProfile } from "@/lib/types/market";

// Workspace presets. Each profile is a starting layout; panels stay
// individually toggleable from the Panels menu.
export const PROFILE_PANELS: Record<ToolProfile, PanelVisibility> = {
  "order-flow": {
    footprint: true, volumeProfile: true, heatmap: false, orderBook: true, obi: true,
    timeSales: true, cvd: true, volumeZ: true, volatility: false, depthOfMarket: false,
    liquidations: true, openInterest: true, venues: false,
  },
  liquidity: {
    footprint: true, volumeProfile: true, heatmap: true, orderBook: true, obi: true,
    timeSales: false, cvd: false, volumeZ: false, volatility: false, depthOfMarket: true,
    liquidations: true, openInterest: false, venues: true,
  },
  volatility: {
    footprint: true, volumeProfile: true, heatmap: false, orderBook: false, obi: false,
    timeSales: true, cvd: false, volumeZ: true, volatility: true, depthOfMarket: false,
    liquidations: false, openInterest: true, venues: false,
  },
};

export type FootprintMode = "bidask" | "delta" | "volume";

export interface IndicatorSettings {
  vwap: boolean;
  vwapBands: boolean; // ±1σ and ±2σ volume-weighted bands
  vwapColor: string | null; // null = theme colour
  sessionPoc: boolean;
  valueArea: boolean;
  valueAreaPct: number; // 0.6 | 0.7 | 0.8
  sessionHighLow: boolean;
  pocColor: string | null;
  imbalances: boolean;
  imbalanceRatio: number; // 2 | 2.5 | 3 | 4
  stackedImbalances: boolean;
  stackedLevels: number; // 2..5
  candlePoc: boolean;
  ohlcStrip: boolean;
  summaryRows: boolean;
  lastPrice: boolean;
  liquidations: boolean; // liquidation bubbles on the footprint (perpetuals)
  bigTrades: boolean; // big-print bubbles on the footprint
  bigTradeRatio: number; // 5 | 10 | 20 | 50 × the session average print
  absorption: boolean; // absorption markers on the footprint
  icebergs: boolean; // iceberg markers on the footprint
  priorDay: boolean; // previous UTC day's POC / VAH / VAL / VWAP
  nakedPocs: boolean; // untested POCs of earlier days
}

export const DEFAULT_INDICATORS: IndicatorSettings = {
  vwap: true,
  vwapBands: false,
  vwapColor: null,
  sessionPoc: true,
  valueArea: true,
  valueAreaPct: 0.7,
  sessionHighLow: false,
  pocColor: null,
  imbalances: true,
  imbalanceRatio: 3,
  stackedImbalances: true,
  stackedLevels: 3,
  candlePoc: true,
  ohlcStrip: true,
  summaryRows: true,
  lastPrice: true,
  liquidations: true,
  bigTrades: true,
  bigTradeRatio: 10,
  absorption: true,
  icebergs: true,
  priorDay: true,
  nakedPocs: true,
};

interface UIStore {
  toolProfile: ToolProfile;
  panels: PanelVisibility;
  theme: Theme;
  heatmap: HeatmapSettings;
  footprintMode: FootprintMode;
  indicators: IndicatorSettings;
  setIndicator: <K extends keyof IndicatorSettings>(key: K, value: IndicatorSettings[K]) => void;
  resetIndicators: () => void;
  setToolProfile: (profile: ToolProfile) => void;
  setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => void;
  setTheme: (theme: Theme) => void;
  setHeatmapVisible: (mode: keyof HeatmapSettings, visible: boolean) => void;
  setFootprintMode: (mode: FootprintMode) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      toolProfile: "order-flow",
      panels: PROFILE_PANELS["order-flow"],
      theme: "dark",
      heatmap: { tradedVolume: false, restingLiquidity: false },
      footprintMode: "bidask",
      indicators: DEFAULT_INDICATORS,
      setIndicator: (key, value) => set((state) => ({ indicators: { ...state.indicators, [key]: value } })),
      resetIndicators: () => set({ indicators: DEFAULT_INDICATORS }),
      setToolProfile: (toolProfile) => {
        const panels = PROFILE_PANELS[toolProfile];
        // The liquidity workspace shows resting depth; the others start without it.
        set({ toolProfile, panels, heatmap: { tradedVolume: panels.heatmap, restingLiquidity: toolProfile === "liquidity" } });
      },
      setPanelVisible: (panel, visible) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: visible },
          heatmap: panel === "heatmap" ? { ...state.heatmap, tradedVolume: visible } : state.heatmap,
        })),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setHeatmapVisible: (mode, visible) =>
        set((state) => ({
          heatmap: { ...state.heatmap, [mode]: visible },
          panels: mode === "tradedVolume" ? { ...state.panels, heatmap: visible } : state.panels,
        })),
      setFootprintMode: (footprintMode) => set({ footprintMode }),
    }),
    {
      name: "oft-ui-preferences",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Hydrated manually after mount to keep SSR markup stable.
      skipHydration: true,
      partialize: (state) => ({
        toolProfile: state.toolProfile,
        panels: state.panels,
        theme: state.theme,
        heatmap: state.heatmap,
        footprintMode: state.footprintMode,
        indicators: state.indicators,
      }),
      migrate: () => ({}) as UIStore,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UIStore>;
        return {
          ...current,
          ...saved,
          panels: { ...current.panels, ...(saved.panels ?? {}) },
          indicators: { ...DEFAULT_INDICATORS, ...(saved.indicators ?? {}) },
          heatmap: { ...current.heatmap, ...(saved.heatmap ?? {}) },
        };
      },
    }
  )
);
