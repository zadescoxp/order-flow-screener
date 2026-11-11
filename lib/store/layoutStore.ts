import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  DEFAULT_PRESET,
  findFreeSpot,
  fitToScreen,
  GRID_PRESETS,
  sanitizeLayout,
  type GridItem,
  type GridPanelId,
} from "@/lib/layout/gridPanels";

// Workspace layout: "classic" is the fixed terminal layout; "grid" is the
// user's own arrangement. The working grid is saved continuously, and users
// can keep named layouts to switch between. Everything persists per browser.

export type LayoutMode = "classic" | "grid";

export interface SavedLayout {
  id: string;
  name: string;
  layout: GridItem[];
  savedAt: number;
}

export const MAX_SAVED_LAYOUTS = 12;
const MAX_NAME = 32;

interface LayoutStore {
  mode: LayoutMode;
  editing: boolean; // not persisted
  layout: GridItem[];
  saved: SavedLayout[];
  activeId: string | null; // saved layout the working copy came from
  dirty: boolean; // working copy differs from activeId
  setMode: (mode: LayoutMode) => void;
  setEditing: (editing: boolean) => void;
  setLayout: (layout: GridItem[]) => void;
  addPanel: (id: GridPanelId) => void;
  removePanel: (id: GridPanelId) => void;
  applyPreset: (presetId: string) => void;
  saveAs: (name: string) => string | null;
  saveActive: () => void;
  load: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const sameLayout = (a: GridItem[], b: GridItem[]) => {
  if (a.length !== b.length) return false;
  const key = (l: GridItem[]) => JSON.stringify([...l].sort((x, y) => x.i.localeCompare(y.i)).map(({ i, x, y, w, h }) => [i, x, y, w, h]));
  return key(a) === key(b);
};

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);

const newId = () => `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set, get) => ({
      mode: "classic",
      editing: false,
      layout: DEFAULT_PRESET.layout.map((item) => ({ ...item })),
      saved: [],
      activeId: null,
      dirty: false,

      setMode: (mode) => set({ mode, editing: false }),
      setEditing: (editing) => set({ editing }),

      setLayout: (next) => {
        const layout = fitToScreen(sanitizeLayout(next));
        const { saved, activeId } = get();
        const active = saved.find((s) => s.id === activeId);
        set({ layout, dirty: active ? !sameLayout(active.layout, layout) : false });
      },

      addPanel: (id) => {
        const { layout } = get();
        if (layout.some((item) => item.i === id)) return;
        get().setLayout([...layout, findFreeSpot(layout, id)]);
      },

      removePanel: (id) => get().setLayout(get().layout.filter((item) => item.i !== id)),

      applyPreset: (presetId) => {
        const preset = GRID_PRESETS.find((p) => p.id === presetId);
        if (!preset) return;
        set({ layout: preset.layout.map((item) => ({ ...item })), activeId: null, dirty: false });
      },

      saveAs: (rawName) => {
        const name = cleanName(rawName);
        if (!name) return null;
        const { saved, layout } = get();
        const existing = saved.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          // Same name overwrites, so users don't pile up near-duplicates.
          set({
            saved: saved.map((s) => (s.id === existing.id ? { ...s, layout: layout.map((i) => ({ ...i })), savedAt: Date.now() } : s)),
            activeId: existing.id,
            dirty: false,
          });
          return existing.id;
        }
        if (saved.length >= MAX_SAVED_LAYOUTS) return null;
        const entry: SavedLayout = { id: newId(), name, layout: layout.map((i) => ({ ...i })), savedAt: Date.now() };
        set({ saved: [...saved, entry], activeId: entry.id, dirty: false });
        return entry.id;
      },

      saveActive: () => {
        const { activeId, saved, layout } = get();
        if (!activeId) return;
        set({
          saved: saved.map((s) => (s.id === activeId ? { ...s, layout: layout.map((i) => ({ ...i })), savedAt: Date.now() } : s)),
          dirty: false,
        });
      },

      load: (id) => {
        const entry = get().saved.find((s) => s.id === id);
        if (!entry) return;
        set({ layout: fitToScreen(sanitizeLayout(entry.layout)), activeId: id, dirty: false, mode: "grid" });
      },

      rename: (id, rawName) => {
        const name = cleanName(rawName);
        if (!name) return;
        set({ saved: get().saved.map((s) => (s.id === id ? { ...s, name } : s)) });
      },

      remove: (id) => {
        const { saved, activeId } = get();
        set({ saved: saved.filter((s) => s.id !== id), activeId: activeId === id ? null : activeId, dirty: activeId === id ? false : get().dirty });
      },
    }),
    {
      name: "oft-layouts",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Hydrated after mount (see Terminal) so server markup stays stable.
      skipHydration: true,
      partialize: (state) => ({
        mode: state.mode,
        layout: state.layout,
        saved: state.saved,
        activeId: state.activeId,
        dirty: state.dirty,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutStore>;
        const saved = Array.isArray(p.saved)
          ? p.saved
              .filter((s): s is SavedLayout => !!s && typeof s.id === "string" && typeof s.name === "string")
              .slice(0, MAX_SAVED_LAYOUTS)
              .map((s) => ({ ...s, name: cleanName(s.name) || "Untitled", layout: fitToScreen(sanitizeLayout(s.layout)) }))
          : [];
        const layout = fitToScreen(sanitizeLayout(p.layout));
        return {
          ...current,
          mode: p.mode === "grid" ? "grid" : "classic",
          layout: layout.length ? layout : current.layout,
          saved,
          activeId: saved.some((s) => s.id === p.activeId) ? (p.activeId as string) : null,
          dirty: Boolean(p.dirty),
        };
      },
    }
  )
);
