"use client";

import React, { useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { useMarketData } from "@/hooks/useMarketData";
import TopBar from "@/components/TopBar";
import FootprintChart from "@/components/FootprintChart";
import VolumeProfilePanel from "@/components/VolumeProfile";
import OrderBookPanel from "@/components/OrderBook";
import OBIPanel from "@/components/OBIPanel";
import DepthOfMarket from "@/components/DepthOfMarket";
import VolatilityPanel from "@/components/VolatilityPanel";
import TradesProfilePanel from "@/components/TradesProfile";
import GlobalTooltip from "@/components/GlobalTooltip";

// ─── Main Terminal Layout ────────────────────────────────────────
// Flex layout for resizable panels

export default function Terminal() {
  useMarketData();

  const panels = useTerminalStore((s) => s.panels);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        background: "var(--bg-base)",
      }}
    >
      <GlobalTooltip />
      <TopBar />

      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          gap: "1px",
          background: "var(--border-muted)",
        }}
      >
        {/* ── LEFT: Volume Profile ── */}
        {panels.volumeProfile && (
          <div style={{ 
            width: 180, 
            minWidth: 100, 
            maxWidth: 400,
            flexShrink: 0, 
            resize: "horizontal", 
            overflow: "hidden", 
            background: "var(--bg-base)" 
          }}>
            <VolumeProfilePanel />
          </div>
        )}

        {/* ── CENTER: Footprint + Volatility + DOM ── */}
        <CenterColumn panels={panels} />

        {/* ── RIGHT: Trades Profile + OBI + Order Book ── */}
        {panels.orderBook && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 240,
              minWidth: 150,
              flexShrink: 0,
              gap: "1px",
              background: "var(--border-muted)",
              overflow: "hidden",
              // We could add horizontal resize here, but native resize is bottom-right.
              // To make it resizable, we can let the center flex: 1 take remaining space.
              // We'll add resize: horizontal and scale it (it will expand rightwards, which is awkward, so we skip it for right pane or keep a fixed default).
            }}
          >
            {panels.tradesProfile && (
              <div style={{ height: "200px", minHeight: 100, resize: "vertical", flexShrink: 0, background: "var(--bg-base)", overflow: "hidden" }}>
                <TradesProfilePanel />
              </div>
            )}
            {panels.obi && (
              <div style={{ height: "120px", minHeight: 60, resize: "vertical", flexShrink: 0, background: "var(--bg-base)", overflow: "hidden" }}>
                <OBIPanel />
              </div>
            )}
            <div style={{ flex: 1, overflow: "hidden", background: "var(--bg-base)" }}>
              <OrderBookPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Center Column ───────────────────────────────────────────────
function CenterColumn({ panels }: { panels: ReturnType<typeof useTerminalStore.getState>["panels"] }) {
  const ticker = useTerminalStore((s) => s.ticker);
  const symbol = useTerminalStore((s) => s.symbol);
  const venue = useTerminalStore((s) => s.venue);
  const timeframe = useTerminalStore((s) => s.timeframe);
  const marketType = useTerminalStore((s) => s.marketType);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 300,
        overflow: "hidden",
        background: "var(--bg-base)",
        gap: "1px",
      }}
    >
      <ChartHeader
        symbol={symbol}
        venue={venue}
        timeframe={timeframe}
        marketType={marketType}
        ticker={ticker}
      />

      <div
        className="panel"
        style={{
          flex: 1,
          border: "none",
          borderBottom: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <FootprintChartWrapper />
      </div>

      {panels.volatility && (
        <div
          style={{
            height: 140,
            minHeight: 100,
            resize: "vertical",
            flexShrink: 0,
            background: "var(--bg-base)",
            overflow: "hidden"
          }}
        >
          <VolatilityPanel />
        </div>
      )}

      {panels.depthOfMarket && (
        <div
          style={{
            height: 140,
            minHeight: 100,
            resize: "vertical",
            flexShrink: 0,
            background: "var(--bg-base)",
            overflow: "hidden"
          }}
        >
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
  ticker: ReturnType<typeof useTerminalStore.getState>["ticker"];
}) {
  const formattedVenue = venue
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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
      <span style={{ color: "var(--text-muted)" }}>·</span>
      <span style={{ color: "var(--text-secondary)" }}>{formattedVenue}</span>
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
