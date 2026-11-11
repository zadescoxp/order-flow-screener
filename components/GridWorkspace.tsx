"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useLayoutStore } from "@/lib/store/layoutStore";
import { GRID_COLS, GRID_PANELS, GRID_ROWS, PANEL_SPEC, readingOrder, type GridItem, type GridPanelId } from "@/lib/layout/gridPanels";
import FootprintChart from "@/components/FootprintChart";
import OrderBookPanel from "@/components/OrderBook";
import OBIPanel from "@/components/OBIPanel";
import TimeAndSales from "@/components/TimeAndSales";
import DepthOfMarket from "@/components/DepthOfMarket";
import CVDPanel from "@/components/CVDPanel";
import VolumeZScorePanel from "@/components/VolumeZScorePanel";
import VolatilityPanel from "@/components/VolatilityPanel";
import LiquidationsPanel from "@/components/LiquidationsPanel";
import OpenInterestPanel from "@/components/OpenInterestPanel";
import VenuesPanel from "@/components/VenuesPanel";
import { Icon } from "@/components/ui/Icons";
import { Menu } from "@/components/ui/Primitives";

const COMPONENTS: Record<GridPanelId, React.ComponentType> = {
  footprint: FootprintChart,
  orderBook: OrderBookPanel,
  obi: OBIPanel,
  timeSales: TimeAndSales,
  cvd: CVDPanel,
  volumeZ: VolumeZScorePanel,
  openInterest: OpenInterestPanel,
  liquidations: LiquidationsPanel,
  venues: VenuesPanel,
  volatility: VolatilityPanel,
  depthOfMarket: DepthOfMarket,
};

const GAP = 8;
const MIN_ROW_HEIGHT = 16;
const STACK_BREAKPOINT = 900; // below this, panels stack in reading order

export default function GridWorkspace() {
  const layout = useLayoutStore((s) => s.layout);
  const editing = useLayoutStore((s) => s.editing);
  const setLayout = useLayoutStore((s) => s.setLayout);
  const marketType = useSessionStore((s) => s.marketType);
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const [height, setHeight] = useState(0);

  // Row height fills the grid area (below the edit bar) with GRID_ROWS rows.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [containerRef]);
  const rowHeight = Math.max(MIN_ROW_HEIGHT, Math.floor((height - GAP * (GRID_ROWS - 1)) / GRID_ROWS));

  const gridLayout: Layout = useMemo(
    () =>
      layout.map((item) => {
        const spec = PANEL_SPEC[item.i];
        return { ...item, minW: spec.minW, minH: spec.minH, maxW: GRID_COLS };
      }),
    [layout]
  );

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (!editing) return;
      setLayout(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }) as GridItem));
    },
    [editing, setLayout]
  );

  const stacked = mounted && width > 0 && width < STACK_BREAKPOINT;

  const cells = (items: readonly GridItem[]) =>
    items.map((item) => (
      <div key={item.i} className={`grid-cell ${editing ? "is-editing" : ""}`} data-panel={item.i}>
        <GridPanel id={item.i} marketType={marketType} />
        {editing && !stacked && <EditOverlay item={item} />}
      </div>
    ));

  return (
    <div className={`grid-workspace ${editing ? "is-editing" : ""}`}>
      {editing && <EditBar />}
      <div className="grid-scroll" ref={containerRef}>
        {layout.length === 0 && <EmptyGrid />}
        {mounted && stacked && <div className="grid-stack">{cells(readingOrder(layout))}</div>}
        {mounted && !stacked && width > 0 && (
          <ReactGridLayout
            width={width}
            layout={gridLayout}
            gridConfig={{ cols: GRID_COLS, rowHeight, margin: [GAP, GAP], containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: ".grid-edit-overlay", cancel: ".grid-edit-remove", threshold: 3 }}
            resizeConfig={{ enabled: editing, handles: ["se", "e", "s"] }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
          >
            {cells(layout)}
          </ReactGridLayout>
        )}
      </div>
    </div>
  );
}

function GridPanel({ id, marketType }: { id: GridPanelId; marketType: string }) {
  const spec = PANEL_SPEC[id];
  if (spec.perpOnly && marketType !== "perpetual") {
    return (
      <section className="panel grid-placeholder" aria-label={spec.label}>
        <strong>{spec.label}</strong>
        <span>Available on perpetual markets</span>
      </section>
    );
  }
  const Component = COMPONENTS[id];
  return <Component />;
}

function EditOverlay({ item }: { item: GridItem }) {
  const removePanel = useLayoutStore((s) => s.removePanel);
  const spec = PANEL_SPEC[item.i];
  return (
    <div className="grid-edit-overlay" title="Drag to move">
      <button
        type="button"
        className="grid-edit-remove"
        aria-label={`Remove ${spec.label}`}
        title={`Remove ${spec.label}`}
        onClick={() => removePanel(item.i)}
      >
        <Icon.Close />
      </button>
      <div className="grid-edit-label">
        <strong>{spec.label}</strong>
        <span>
          {item.w} × {item.h}
        </span>
      </div>
    </div>
  );
}

function AddPanelMenu() {
  const layout = useLayoutStore((s) => s.layout);
  const addPanel = useLayoutStore((s) => s.addPanel);
  const missing = GRID_PANELS.filter((spec) => !layout.some((item) => item.i === spec.id));
  return (
    <Menu buttonClassName="chip" label={<>+ Add panel</>} align="left">
      <div className="grid-add-menu">
        {missing.length === 0 && <div className="grid-add-empty">Every panel is on the grid</div>}
        {missing.map((spec) => (
          <button key={spec.id} type="button" className="grid-add-item" onClick={() => addPanel(spec.id)}>
            <span>{spec.label}</span>
            <small>{spec.hint}</small>
          </button>
        ))}
      </div>
    </Menu>
  );
}

function EditBar() {
  const setEditing = useLayoutStore((s) => s.setEditing);
  return (
    <div className="grid-edit-bar" role="toolbar" aria-label="Layout editing">
      <span className="grid-edit-bar-title">Editing layout</span>
      <span className="grid-edit-bar-hint">Drag a panel to move it · drag its edge or corner to resize</span>
      <AddPanelMenu />
      <button type="button" className="ui-button chip is-primary" onClick={() => setEditing(false)}>
        Done
      </button>
    </div>
  );
}

function EmptyGrid() {
  const setEditing = useLayoutStore((s) => s.setEditing);
  const applyPreset = useLayoutStore((s) => s.applyPreset);
  return (
    <div className="grid-empty">
      <strong>Your grid is empty</strong>
      <span>Add panels while editing, or start from a preset.</span>
      <div className="grid-empty-actions">
        <button type="button" className="ui-button chip" onClick={() => setEditing(true)}>
          Edit layout
        </button>
        <button type="button" className="ui-button chip is-primary" onClick={() => applyPreset("order-flow")}>
          Use Order flow preset
        </button>
      </div>
    </div>
  );
}
