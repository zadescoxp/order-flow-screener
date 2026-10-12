import { create } from "zustand";
import { applyTheme, type Theme } from "@/lib/theme";
import type { PanelVisibility, ToolProfile } from "@/lib/types/market";

const PROFILE_PANELS: Record<ToolProfile, PanelVisibility> = {
  "order-flow": {
    volumeProfile: true, footprint: true, volatility: false, depthOfMarket: true,
    tradesProfile: true, obi: true, orderBook: true, heatmap: false,
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
  setToolProfile: (profile: ToolProfile) => void;
  setPanelVisible: (panel: keyof PanelVisibility, visible: boolean) => void;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  toolProfile: "order-flow",
  panels: PROFILE_PANELS["order-flow"],
  theme: "dark",
  setToolProfile: (toolProfile) => set({ toolProfile, panels: PROFILE_PANELS[toolProfile] }),
  setPanelVisible: (panel, visible) =>
    set((state) => ({ panels: { ...state.panels, [panel]: visible } })),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
