"use client";

import React, { useEffect, useLayoutEffect } from "react";
import { useMarketData } from "@/hooks/useMarketData";
import { useAlerts } from "@/hooks/useAlerts";
import { useAlertStore } from "@/lib/store/alertStore";
import AlertToasts from "@/components/AlertToasts";
import ReplayBar from "@/components/ReplayBar";
import { MarketSessionProvider, useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { applyTheme } from "@/lib/theme";
import TopBar from "@/components/TopBar";
import MarketStatsBar from "@/components/MarketStatsBar";
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
import GlobalTooltip from "@/components/GlobalTooltip";
import HoverHint from "@/components/HoverHint";
import StatusBar from "@/components/StatusBar";
import BugReportDialog from "@/components/BugReportDialog";
import type { PanelVisibility } from "@/lib/types/market";

// ─── Terminal shell ──────────────────────────────────────────────
//  ┌ top bar ─────────────────────────────────────────────┐
//  ├ KPI strip ───────────────────────────────────────────┤
//  │ footprint + session profile        │ order book       │
//  │                                    │ book imbalance   │
//  ├ studies: CVD · Vol Z · OI · Liq ·  ─┤ time & sales     │
//  │          RV · Depth                 │                  │
//  └ status bar ──────────────────────────────────────────┘

const STUDIES: { key: keyof PanelVisibility; Component: React.ComponentType; perpOnly?: boolean }[] = [
  { key: "cvd", Component: CVDPanel },
  { key: "volumeZ", Component: VolumeZScorePanel },
  { key: "openInterest", Component: OpenInterestPanel, perpOnly: true },
  { key: "liquidations", Component: LiquidationsPanel, perpOnly: true },
  { key: "venues", Component: VenuesPanel },
  { key: "volatility", Component: VolatilityPanel },
  { key: "depthOfMarket", Component: DepthOfMarket },
];

export default function Terminal() {
  return (
    <MarketSessionProvider>
      <SessionTerminal />
    </MarketSessionProvider>
  );
}

function SessionTerminal() {
  useMarketData();
  useAlerts();

  const panels = useUIStore((s) => s.panels);
  const theme = useUIStore((s) => s.theme);
  const [sidebarWidth, setSidebarWidth] = React.useState(320);
  const [dockHeight, setDockHeight] = React.useState(236);
  const [obiHeight, setObiHeight] = React.useState(160);
  const [bookShare, setBookShare] = React.useState(0.56);
  const sidebarRef = React.useRef<HTMLElement>(null);

  useEffect(() => {
    void useUIStore.persist.rehydrate();
    void useAlertStore.persist.rehydrate();
  }, []);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The value-area % is a UI preference but the profile is computed in the session.
  const valueAreaPct = useUIStore((s) => s.indicators.valueAreaPct);
  const setValueAreaPct = useSessionStore((s) => s.setValueAreaPct);
  useEffect(() => setValueAreaPct(valueAreaPct), [valueAreaPct, setValueAreaPct]);

  const marketType = useSessionStore((s) => s.marketType);
  // Liquidations and open interest exist only for perpetual markets.
  const studies = STUDIES.filter((study) => panels[study.key] && (!study.perpOnly || marketType === "perpetual"));
  const showSidebar = panels.orderBook || panels.obi || panels.timeSales;

  return (
    <div className="terminal">
      <GlobalTooltip />
      <HoverHint />
      <BugReportDialog />
      <TopBar />
      <ReplayBar />
      <MarketStatsBar />

      <div className="workspace">
        <div className="workspace-main">
          <div className="chart-area">
            <FootprintChart />
          </div>
          {studies.length > 0 && (
            <div className="studies-dock" style={{ height: dockHeight }}>
              <ResizeHandle direction="top" onResize={(d) => setDockHeight((h) => clamp(h - d, 180, 560))} />
              {studies.map(({ key, Component }) => (
                <div key={key} className="study-slot">
                  <Component />
                </div>
              ))}
            </div>
          )}
        </div>

        {showSidebar && (
          <aside className="sidebar" style={{ width: sidebarWidth }} ref={sidebarRef}>
            <ResizeHandle direction="left" onResize={(d) => setSidebarWidth((w) => clamp(w - d, 260, 520))} />
            {panels.orderBook && (
              <div className="sidebar-slot" style={{ flex: panels.timeSales ? `${bookShare} 1 0` : "1 1 0" }}>
                <OrderBookPanel />
                {panels.timeSales && (
                  <ResizeHandle
                    direction="bottom"
                    onResize={(d) => {
                      const total = sidebarRef.current?.clientHeight ?? 800;
                      setBookShare((s) => clamp(s + d / total, 0.25, 0.8));
                    }}
                  />
                )}
              </div>
            )}
            {panels.obi && (
              <div className="sidebar-slot" style={{ flex: `0 0 ${obiHeight}px` }}>
                <OBIPanel />
                <ResizeHandle direction="bottom" onResize={(d) => setObiHeight((h) => clamp(h + d, 140, 340))} />
              </div>
            )}
            {panels.timeSales && (
              <div className="sidebar-slot" style={{ flex: panels.orderBook ? `${1 - bookShare} 1 0` : "1 1 0" }}>
                <TimeAndSales />
              </div>
            )}
          </aside>
        )}
      </div>

      <StatusBar />
      <AlertToasts />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ResizeHandle({
  direction,
  onResize,
}: {
  direction: "left" | "right" | "top" | "bottom";
  onResize: (delta: number) => void;
}) {
  const start = React.useRef(0);
  const vertical = direction === "top" || direction === "bottom";
  return (
    <span
      className={`resize-handle resize-handle-${direction}`}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = vertical ? event.clientY : event.clientX;
        const move = (moveEvent: PointerEvent) => {
          const current = vertical ? moveEvent.clientY : moveEvent.clientX;
          const delta = current - start.current;
          if (delta !== 0) {
            onResize(delta);
            start.current = current;
          }
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          document.body.classList.remove("is-resizing", "is-resizing-row");
        };
        document.body.classList.add("is-resizing");
        if (vertical) document.body.classList.add("is-resizing-row");
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
      }}
    />
  );
}
