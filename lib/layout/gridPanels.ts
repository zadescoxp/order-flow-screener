// Custom grid workspace: panel registry, presets and pure layout helpers.
//
// The grid is 12 columns by GRID_ROWS rows sized to fill the screen. Every
// panel has a minimum size so charts, ladders and tapes stay readable, and
// layouts never overlap (react-grid-layout's vertical compactor).

export type GridPanelId =
  | "footprint"
  | "orderBook"
  | "obi"
  | "timeSales"
  | "cvd"
  | "volumeZ"
  | "openInterest"
  | "liquidations"
  | "venues"
  | "volatility"
  | "depthOfMarket";

export interface GridItem {
  i: GridPanelId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridPanelSpec {
  id: GridPanelId;
  label: string;
  hint: string;
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  perpOnly?: boolean;
}

export const GRID_COLS = 12;
export const GRID_ROWS = 24; // rows that fit the viewport; taller layouts scroll

export const GRID_PANELS: readonly GridPanelSpec[] = [
  { id: "footprint", label: "Footprint", hint: "Price × time × volume with session profile", minW: 4, minH: 8, defaultW: 8, defaultH: 14 },
  { id: "orderBook", label: "Order book", hint: "Price ladder with liquidity walls", minW: 2, minH: 7, defaultW: 3, defaultH: 10 },
  { id: "obi", label: "Book imbalance", hint: "OBI gauge and history", minW: 2, minH: 4, defaultW: 3, defaultH: 5 },
  { id: "timeSales", label: "Time & sales", hint: "Executed prints and block trades", minW: 2, minH: 6, defaultW: 3, defaultH: 10 },
  { id: "cvd", label: "Cumulative delta", hint: "CVD with price overlay", minW: 3, minH: 5, defaultW: 4, defaultH: 8 },
  { id: "volumeZ", label: "Volume z-score", hint: "Unusual participation", minW: 3, minH: 5, defaultW: 4, defaultH: 8 },
  { id: "openInterest", label: "Open interest", hint: "Aggregated OI and funding", minW: 3, minH: 5, defaultW: 4, defaultH: 8, perpOnly: true },
  { id: "liquidations", label: "Liquidations", hint: "Forced closes by side", minW: 3, minH: 5, defaultW: 4, defaultH: 8, perpOnly: true },
  { id: "venues", label: "Venues", hint: "Cross-venue comparison", minW: 3, minH: 5, defaultW: 4, defaultH: 8 },
  { id: "volatility", label: "Realized volatility", hint: "RV, ATR, Parkinson", minW: 3, minH: 5, defaultW: 4, defaultH: 8 },
  { id: "depthOfMarket", label: "Market depth", hint: "Cumulative liquidity curve", minW: 3, minH: 5, defaultW: 4, defaultH: 8 },
];

export const PANEL_SPEC: Record<GridPanelId, GridPanelSpec> = Object.fromEntries(
  GRID_PANELS.map((spec) => [spec.id, spec])
) as Record<GridPanelId, GridPanelSpec>;

export function isGridPanelId(value: string): value is GridPanelId {
  return value in PANEL_SPEC;
}

export interface GridPreset {
  id: string;
  name: string;
  description: string;
  layout: GridItem[];
}

export const GRID_PRESETS: readonly GridPreset[] = [
  {
    id: "order-flow",
    name: "Order flow",
    description: "Footprint, book, tape and flow studies",
    layout: [
      { i: "footprint", x: 0, y: 0, w: 9, h: 15 },
      { i: "orderBook", x: 9, y: 0, w: 3, h: 10 },
      { i: "obi", x: 9, y: 10, w: 3, h: 4 },
      { i: "timeSales", x: 9, y: 14, w: 3, h: 10 },
      { i: "cvd", x: 0, y: 15, w: 3, h: 9 },
      { i: "volumeZ", x: 3, y: 15, w: 3, h: 9 },
      { i: "liquidations", x: 6, y: 15, w: 3, h: 9 },
    ],
  },
  {
    id: "liquidity",
    name: "Liquidity",
    description: "Book, depth, imbalance and venues",
    layout: [
      { i: "footprint", x: 0, y: 0, w: 8, h: 16 },
      { i: "orderBook", x: 8, y: 0, w: 4, h: 12 },
      { i: "obi", x: 8, y: 12, w: 4, h: 5 },
      { i: "depthOfMarket", x: 0, y: 16, w: 4, h: 8 },
      { i: "venues", x: 4, y: 16, w: 4, h: 8 },
      { i: "liquidations", x: 8, y: 17, w: 4, h: 7 },
    ],
  },
  {
    id: "volatility",
    name: "Volatility",
    description: "Realized vol, volume z-score and OI",
    layout: [
      { i: "footprint", x: 0, y: 0, w: 9, h: 14 },
      { i: "timeSales", x: 9, y: 0, w: 3, h: 14 },
      { i: "volatility", x: 0, y: 14, w: 4, h: 10 },
      { i: "volumeZ", x: 4, y: 14, w: 4, h: 10 },
      { i: "openInterest", x: 8, y: 14, w: 4, h: 10 },
    ],
  },
  {
    id: "scalper",
    name: "Scalper",
    description: "Tall footprint with ladder and tape",
    layout: [
      { i: "footprint", x: 0, y: 0, w: 7, h: 24 },
      { i: "orderBook", x: 7, y: 0, w: 3, h: 17 },
      { i: "obi", x: 7, y: 17, w: 3, h: 7 },
      { i: "timeSales", x: 10, y: 0, w: 2, h: 24 },
    ],
  },
  {
    id: "focus",
    name: "Focus",
    description: "Full-width footprint with two studies",
    layout: [
      { i: "footprint", x: 0, y: 0, w: 12, h: 17 },
      { i: "cvd", x: 0, y: 17, w: 6, h: 7 },
      { i: "volumeZ", x: 6, y: 17, w: 6, h: 7 },
    ],
  },
];

export const DEFAULT_PRESET = GRID_PRESETS[0];

function overlaps(a: GridItem, b: GridItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Make a layout safe to render: drop unknown or duplicate panels, enforce
 * minimum sizes and grid bounds, and push overlapping items down until free.
 * Used for anything read back from storage.
 */
export function sanitizeLayout(input: unknown): GridItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const items: GridItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { i, x, y, w, h } = raw as Record<string, unknown>;
    if (typeof i !== "string" || !isGridPanelId(i) || seen.has(i)) continue;
    const spec = PANEL_SPEC[i];
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback);
    const width = Math.min(GRID_COLS, Math.max(spec.minW, num(w, spec.defaultW)));
    const item: GridItem = {
      i,
      w: width,
      h: Math.max(spec.minH, num(h, spec.defaultH)),
      x: Math.min(GRID_COLS - width, Math.max(0, num(x, 0))),
      y: Math.max(0, num(y, 0)),
    };
    seen.add(i);
    items.push(item);
  }
  // Resolve overlaps top-to-bottom so every panel keeps its full area.
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [];
  for (const item of items) {
    while (placed.some((p) => overlaps(p, item))) item.y += 1;
    placed.push(item);
  }
  return placed;
}

/** Lowest row below every item. */
export function layoutBottom(layout: readonly GridItem[]): number {
  return layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * First free position for a panel at its default size, scanning row by row
 * within the screen; falls back to the bottom of the layout.
 */
export function findFreeSpot(layout: readonly GridItem[], id: GridPanelId): GridItem {
  const spec = PANEL_SPEC[id];
  for (const [w, h] of [[spec.defaultW, spec.defaultH], [spec.minW, spec.minH]]) {
    for (let y = 0; y + h <= GRID_ROWS; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        const candidate = { i: id, x, y, w, h };
        if (!layout.some((item) => overlaps(item, candidate))) return candidate;
      }
    }
  }
  return { i: id, x: 0, y: layoutBottom(layout), w: spec.defaultW, h: spec.defaultH };
}

/**
 * Keep the grid on one screen: any panel pushed below GRID_ROWS (e.g. by a
 * drag that displaced it) moves into the first free on-screen space that fits
 * its current size, or failing that its minimum size. Panels only stay below
 * the fold when the screen is genuinely full.
 */
export function fitToScreen(layout: readonly GridItem[]): GridItem[] {
  const onScreen = layout.filter((item) => item.y + item.h <= GRID_ROWS).map((item) => ({ ...item }));
  const overflow = layout.filter((item) => item.y + item.h > GRID_ROWS).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [...onScreen];
  for (const item of overflow) {
    const spec = PANEL_SPEC[item.i];
    let spot: GridItem | null = null;
    for (const [w, h] of [[item.w, item.h], [spec.minW, spec.minH]]) {
      for (let y = 0; !spot && y + h <= GRID_ROWS; y++) {
        for (let x = 0; x + w <= GRID_COLS; x++) {
          const candidate = { i: item.i, x, y, w, h };
          if (!placed.some((p) => overlaps(p, candidate))) {
            spot = candidate;
            break;
          }
        }
      }
      if (spot) break;
    }
    placed.push(spot ?? { ...item, y: Math.max(item.y, layoutBottom(placed)) });
  }
  return placed;
}

/** Panels in reading order (top-to-bottom, left-to-right) for the stacked mobile view. */
export function readingOrder(layout: readonly GridItem[]): GridItem[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
}
