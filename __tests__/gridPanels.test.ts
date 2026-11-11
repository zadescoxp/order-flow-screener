import {
  findFreeSpot,
  fitToScreen,
  GRID_COLS,
  GRID_PRESETS,
  GRID_ROWS,
  layoutBottom,
  PANEL_SPEC,
  readingOrder,
  sanitizeLayout,
  type GridItem,
} from "@/lib/layout/gridPanels";

const overlap = (a: GridItem, b: GridItem) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertClean(layout: GridItem[]) {
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    const spec = PANEL_SPEC[item.i];
    expect(item.w).toBeGreaterThanOrEqual(spec.minW);
    expect(item.h).toBeGreaterThanOrEqual(spec.minH);
    expect(item.x + item.w).toBeLessThanOrEqual(GRID_COLS);
    for (let j = i + 1; j < layout.length; j++) expect(overlap(item, layout[j])).toBe(false);
  }
}

describe("grid presets", () => {
  it.each(GRID_PRESETS.map((p) => [p.name, p] as const))("%s fits the screen without overlaps or undersized panels", (_, preset) => {
    assertClean([...preset.layout]);
    expect(layoutBottom(preset.layout)).toBeLessThanOrEqual(GRID_ROWS);
    expect(sanitizeLayout(preset.layout)).toEqual(preset.layout.map((item) => ({ ...item })).sort((a, b) => a.y - b.y || a.x - b.x));
  });
});

describe("sanitizeLayout", () => {
  it("drops unknown and duplicate panels and garbage values", () => {
    const layout = sanitizeLayout([
      { i: "footprint", x: 0, y: 0, w: 8, h: 14 },
      { i: "footprint", x: 8, y: 0, w: 4, h: 8 },
      { i: "notAPanel", x: 0, y: 0, w: 1, h: 1 },
      null,
      "nope",
    ]);
    expect(layout.map((item) => item.i)).toEqual(["footprint"]);
    expect(sanitizeLayout("not an array")).toEqual([]);
  });

  it("enforces minimum sizes, grid bounds and removes overlaps", () => {
    const layout = sanitizeLayout([
      { i: "footprint", x: 10, y: -3, w: 1, h: 1 },
      { i: "orderBook", x: 0, y: 0, w: 3, h: 10 },
      { i: "cvd", x: 0, y: 0, w: 99, h: 2.4 },
    ]);
    assertClean(layout);
    expect(layout.find((i) => i.i === "footprint")!.x).toBeLessThanOrEqual(GRID_COLS - PANEL_SPEC.footprint.minW);
  });
});

describe("findFreeSpot", () => {
  it("fills the first gap that fits instead of stacking below", () => {
    const layout: GridItem[] = [{ i: "footprint", x: 0, y: 0, w: 8, h: 24 }];
    const spot = findFreeSpot(layout, "orderBook");
    expect(spot).toMatchObject({ x: 8, y: 0, w: PANEL_SPEC.orderBook.defaultW });
    assertClean([...layout, spot]);
  });

  it("goes below the layout when the screen is full", () => {
    const full: GridItem[] = [{ i: "footprint", x: 0, y: 0, w: 12, h: 24 }];
    expect(findFreeSpot(full, "cvd")).toMatchObject({ x: 0, y: 24 });
  });
});

describe("fitToScreen", () => {
  it("moves a panel displaced below the screen into the slot that was vacated", () => {
    // Order-flow preset after dragging Volume z-score onto Cumulative delta:
    // the compactor pushes CVD to row 24, leaving x=3 empty.
    const afterDrag: GridItem[] = [
      { i: "footprint", x: 0, y: 0, w: 9, h: 15 },
      { i: "orderBook", x: 9, y: 0, w: 3, h: 10 },
      { i: "obi", x: 9, y: 10, w: 3, h: 4 },
      { i: "timeSales", x: 9, y: 14, w: 3, h: 10 },
      { i: "volumeZ", x: 0, y: 15, w: 3, h: 9 },
      { i: "liquidations", x: 6, y: 15, w: 3, h: 9 },
      { i: "cvd", x: 0, y: 24, w: 3, h: 9 },
    ];
    const fitted = fitToScreen(afterDrag);
    expect(fitted.find((i) => i.i === "cvd")).toMatchObject({ x: 3, y: 15, w: 3, h: 9 });
    assertClean(fitted);
    expect(layoutBottom(fitted)).toBeLessThanOrEqual(GRID_ROWS);
  });

  it("shrinks to the minimum size before giving up, and leaves panels below only when full", () => {
    const tight: GridItem[] = [
      { i: "footprint", x: 0, y: 0, w: 12, h: 19 },
      { i: "cvd", x: 0, y: 24, w: 6, h: 8 },
    ];
    expect(fitToScreen(tight).find((i) => i.i === "cvd")).toMatchObject({ y: 19, w: PANEL_SPEC.cvd.minW, h: PANEL_SPEC.cvd.minH });
    const full: GridItem[] = [{ i: "footprint", x: 0, y: 0, w: 12, h: 24 }, { i: "cvd", x: 0, y: 24, w: 4, h: 8 }];
    expect(fitToScreen(full).find((i) => i.i === "cvd")!.y).toBeGreaterThanOrEqual(24);
  });
});

describe("readingOrder", () => {
  it("orders panels top-to-bottom then left-to-right", () => {
    const order = readingOrder([
      { i: "cvd", x: 0, y: 15, w: 3, h: 9 },
      { i: "orderBook", x: 9, y: 0, w: 3, h: 10 },
      { i: "footprint", x: 0, y: 0, w: 9, h: 15 },
    ]).map((item) => item.i);
    expect(order).toEqual(["footprint", "orderBook", "cvd"]);
  });
});
