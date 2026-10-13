"use client";

import React, { useRef, useCallback, useLayoutEffect } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useMarketData } from "@/hooks/useMarketData";
import { MarketSessionProvider } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { applyTheme } from "@/lib/theme";
import TopBar from "@/components/TopBar";
import FootprintChart from "@/components/FootprintChart";
import VolumeProfilePanel from "@/components/VolumeProfile";
import OrderBookPanel from "@/components/OrderBook";
import OBIPanel from "@/components/OBIPanel";
import DepthOfMarket from "@/components/DepthOfMarket";
import VolatilityPanel from "@/components/VolatilityPanel";
import TradesProfilePanel from "@/components/TradesProfile";
import GlobalTooltip from "@/components/GlobalTooltip";
import ConnectionStatusBar from "@/components/ConnectionStatus";
import type { MarketTicker, PanelVisibility } from "@/lib/types/market";

// ─── Main Terminal Layout ────────────────────────────────────────
// Flex layout for resizable panels

export default function Terminal() {
  return <MarketSessionProvider><SessionTerminal /></MarketSessionProvider>;
}

function SessionTerminal() {
  useMarketData();

  const panels = useUIStore((s) => s.panels);
  const theme = useUIStore((s) => s.theme);

  // Apply theme immediately before paint — directly sets CSS vars on :root
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="terminal-shell">
      <GlobalTooltip />
      <TopBar />
      <div className="status-strip">
        <ConnectionStatusBar />
      </div>

      <div className="terminal-workspace">
        {/* ── LEFT: Volume Profile ── */}
        {panels.volumeProfile && (
          <div className="workspace-left">
            <VolumeProfilePanel />
          </div>
        )}

        {/* ── CENTER: Footprint + Volatility + DOM ── */}
        <CenterColumn panels={panels} />

        {/* ── RIGHT: Trades Profile + OBI + Order Book ── */}
        {panels.orderBook && (
          <div className="workspace-right">
            {panels.tradesProfile && (
              <div className="workspace-right-section trades-section">
                <TradesProfilePanel />
              </div>
            )}
            {panels.obi && (
              <div className="workspace-right-section obi-section">
                <OBIPanel />
              </div>
            )}
            <div className="workspace-orderbook">
              <OrderBookPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Center Column ───────────────────────────────────────────────
function CenterColumn({ panels }: { panels: PanelVisibility }) {
  const ticker = useSessionStore((s) => s.ticker);
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const timeframe = useSessionStore((s) => s.timeframe);
  const marketType = useSessionStore((s) => s.marketType);

  return (
    <div className="workspace-center">
      <ChartHeader
        symbol={symbol}
        venue={venue}
        timeframe={timeframe}
        marketType={marketType}
        ticker={ticker}
      />

      <div className="chart-card">
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <FootprintChartWrapper />
        </div>
      </div>

      {panels.volatility && (
        <div className="workspace-bottom-panel">
          <VolatilityPanel />
        </div>
      )}

      {panels.depthOfMarket && (
        <div className="workspace-bottom-panel">
          <DepthOfMarket />
        </div>
      )}
    </div>
  );
}

// ─── Chart Header ────────────────────────────────────────────────
function ChartHeader({
  symbol,
  venue,
  timeframe,
  marketType,
  ticker,
}: {
  symbol: string;
  venue: string;
  timeframe: string;
  marketType: string;
  ticker: MarketTicker | null;
}) {
  const formattedVenue = venue
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const isForex = marketType === "forex";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        height: 26,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        fontSize: 11,
      }}
    >
      <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{symbol}</span>
      <span style={{ color: "var(--text-muted)" }}>·</span>
      <span style={{ color: "var(--text-muted)" }}>{timeframe}</span>
      {!isForex && <><span style={{ color: "var(--text-muted)" }}>·</span>
      <span style={{ color: "var(--text-secondary)" }}>{formattedVenue}</span></>}
      <span style={{ color: "var(--text-muted)" }}>
        ({marketType.charAt(0).toUpperCase() + marketType.slice(1)})
      </span>

      {ticker && (
        <>
          <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
            O{" "}
            <span style={{ color: "var(--text-secondary)" }}>
              {ticker.open.toFixed(1)}
            </span>
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            H{" "}
            <span style={{ color: "var(--buy)" }}>
              {ticker.high.toFixed(1)}
            </span>
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            L{" "}
            <span style={{ color: "var(--sell)" }}>
              {ticker.low.toFixed(1)}
            </span>
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            C{" "}
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {ticker.price.toFixed(1)}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

// ─── Footprint Chart Wrapper ─────────────────────────────────────
// Dynamically reads available height and passes to canvas renderer
function FootprintChartWrapper() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(400);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setHeight(el.clientHeight);
    });
    obs.observe(el);
    setHeight(el.clientHeight);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <FootprintChart height={height} />
    </div>
  );
}
