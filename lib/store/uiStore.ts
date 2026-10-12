import { create } from "zustand";
import { applyTheme, type Theme } from "@/lib/theme";
import type { HeatmapSettings, PanelVisibility, ToolProfile } from "@/lib/types/market";

const PROFILE_PANELS: Record<ToolProfile, PanelVisibility> = {
  "order-flow": {
    volumeProfile: true, footprint: true, volatility: false, depthOfMarket: true,
    tradesProfile: true, obi: true, orderBook: true, heatmap: true,
  },
  liquidity: {
    volumeProfile: false, footprint: true, volatility: false, depthOfMarket: true,
    tradesProfile: false, obi: true, orderBook: true, heatmap: true,
  },
  volatility: {
    volumeProfile: true, footprint: true, volatility: true, depthOfMarket: false,
    tradesProfile: false, obi: false, orderBook: false, heatmap: true,
  },
};

interface UIStore {
  toolProfile: ToolProfile;
  panels: PanelVisibility;
  theme: Theme;
  heatmap: HeatmapSettings;
  setToolProfile: (profile: ToolProfile) => void;
  setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => void;
  setTheme: (theme: Theme) => void;
  setHeatmapVisible: (mode: keyof HeatmapSettings, visible: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  toolProfile: "order-flow",
  panels: PROFILE_PANELS["order-flow"],
  theme: "dark",
  heatmap: { tradedVolume: true },
  setToolProfile: (toolProfile) => set({ toolProfile, panels: PROFILE_PANELS[toolProfile] }),
  setPanelVisible: (panel, visible) =>
    set((state) => ({ panels: { ...state.panels, [panel]: visible } })),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setHeatmapVisible: (mode, visible) =>
    set((state) => ({ heatmap: { ...state.heatmap, [mode]: visible } })),
}));
