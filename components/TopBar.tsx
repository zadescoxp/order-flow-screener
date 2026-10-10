"use client";

import React from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import type { Venue, Timeframe, MarketType, ToolProfile } from "@/lib/types/market";

// ─── Asset options ───────────────────────────────────────────
const ASSETS_PERP = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT"];
const ASSETS_SPOT = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

const VENUES_PERP: { value: Venue; label: string }[] = [
  { value: "binance-futures", label: "Binance" },
  { value: "bybit-futures", label: "Bybit" },
  { value: "okx-futures", label: "OKX" },
  { value: "hyperliquid", label: "Hyperliquid" },
  { value: "bitget-futures", label: "Bitget" },
  { value: "deribit", label: "Deribit" },
];

const VENUES_SPOT: { value: Venue; label: string }[] = [
  { value: "binance-spot", label: "Binance" },
  { value: "coinbase-spot", label: "Coinbase" },
  { value: "okx-spot", label: "OKX" },
  { value: "bybit-spot", label: "Bybit" },
  { value: "bitget-spot", label: "Bitget" },
];

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h"];

const PROFILES: { value: ToolProfile; label: string }[] = [
  { value: "order-flow", label: "Order Flow" },
  { value: "liquidity", label: "Liquidity" },
  { value: "volatility", label: "Volatility" },
];

// ─── Status bar ───────────────────────────────────────────
function ConnectionStatus() {
  const connections = useTerminalStore((s) => s.connections);
  const ticker = useTerminalStore((s) => s.ticker);
  const venue = useTerminalStore((s) => s.venue);

  const conn = connections[venue];
  const status = conn?.status ?? "connecting";

  return (
    <div className="flex items-center gap-3 ml-auto">
      <div className="flex items-center gap-2">
        <span
          className={`status-dot ${status}`}
          title={status}
        />
        <span
          style={{
            fontSize: 10,
            color: status === "live" ? "var(--buy)" : "var(--text-muted)",
          }}
        >
          {status === "live"
            ? "LIVE"
            : status === "connecting"
            ? "CONNECTING"
            : status.toUpperCase()}
        </span>
      </div>
      {ticker && (
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
          {ticker.price.toLocaleString("en-US", { minimumFractionDigits: 1 })}
        </span>
      )}
    </div>
  );
}

// ─── Top Bar ─────────────────────────────────────────────
export default function TopBar() {
  const symbol = useTerminalStore((s) => s.symbol);
  const venue = useTerminalStore((s) => s.venue);
  const marketType = useTerminalStore((s) => s.marketType);
  const timeframe = useTerminalStore((s) => s.timeframe);
  const toolProfile = useTerminalStore((s) => s.toolProfile);
  const ticker = useTerminalStore((s) => s.ticker);

  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const setVenue = useTerminalStore((s) => s.setVenue);
  const setMarketType = useTerminalStore((s) => s.setMarketType);
  const setTimeframe = useTerminalStore((s) => s.setTimeframe);
  const setToolProfile = useTerminalStore((s) => s.setToolProfile);

  const assets = marketType === "perpetual" ? ASSETS_PERP : ASSETS_SPOT;
  const venues = marketType === "perpetual" ? VENUES_PERP : VENUES_SPOT;

  const changeStr =
    ticker
      ? `${ticker.change >= 0 ? "+" : ""}${ticker.change.toFixed(1)} (${ticker.changePct >= 0 ? "+" : ""}${ticker.changePct.toFixed(2)}%)`
      : null;
  const changeColor = ticker ? (ticker.change >= 0 ? "var(--buy)" : "var(--sell)") : "var(--text-muted)";

  return (
    <div className="topbar">
      {/* ── Logo ── */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color: "var(--text-accent)",
          marginRight: 6,
          flexShrink: 0,
        }}
      >
        ⬡ OFT
      </div>

      <div className="topbar-sep" />

      {/* ── Asset ── */}
      <div className="select-wrap">
        <select
          className="terminal-select"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={{ fontWeight: 600, fontSize: 12, color: "var(--text-primary)" }}
          id="asset-selector"
        >
          {assets.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="select-arrow">▾</span>
      </div>

      {/* ── Ticker info ── */}
      {ticker && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginLeft: 4,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
            {ticker.price.toLocaleString("en-US", { minimumFractionDigits: 1 })}
          </span>
          <span style={{ fontSize: 10, color: changeColor }}>{changeStr}</span>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
            O {ticker.open.toFixed(1)} H {ticker.high.toFixed(1)} L {ticker.low.toFixed(1)}
          </span>
        </div>
      )}

      <div className="topbar-sep" />

      {/* ── Timeframe ── */}
      <div className="tab-group">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            className={`tab ${timeframe === tf ? "active" : ""}`}
            onClick={() => setTimeframe(tf)}
            id={`tf-${tf}`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="topbar-sep" />

      {/* ── Market Type ── */}
      <div className="select-wrap">
        <select
          className="terminal-select"
          value={marketType}
          onChange={(e) => setMarketType(e.target.value as MarketType)}
          id="market-type-selector"
        >
          <option value="perpetual">Perpetual</option>
          <option value="spot">Spot</option>
        </select>
        <span className="select-arrow">▾</span>
      </div>

      <div className="topbar-sep" />

      {/* ── Venue ── */}
      <div className="select-wrap">
        <select
          className="terminal-select"
          value={venue}
          onChange={(e) => setVenue(e.target.value as Venue)}
          id="venue-selector"
        >
          {venues.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="select-arrow">▾</span>
      </div>

      <div className="topbar-sep" />

      {/* ── Tool Profile Toggles ── */}
      <div className="tab-group" style={{ display: "flex", gap: 2 }}>
        {PROFILES.map((p) => {
          const currentPanels = useTerminalStore.getState().panels;
          const isProfileActive = 
              p.value === "order-flow" ? currentPanels.footprint && currentPanels.orderBook && currentPanels.tradesProfile
            : p.value === "liquidity" ? currentPanels.heatmap
            : currentPanels.volatility;

          return (
            <button
              key={p.value}
              className={`tab ${isProfileActive ? "active" : ""}`}
              onClick={() => {
                const targetPanels = p.value === "order-flow" 
                  ? { footprint: true, orderBook: true, volumeProfile: true, depthOfMarket: true, tradesProfile: true, obi: true }
                  : p.value === "liquidity"
                  ? { heatmap: true, footprint: true, depthOfMarket: true, obi: true, orderBook: true }
                  : { volatility: true, footprint: true, volumeProfile: true, heatmap: true };
                
                // Toggle logic: if active, turn these specific panels off, else turn them on
                const setPanelVisible = useTerminalStore.getState().setPanelVisible;
                Object.entries(targetPanels).forEach(([key, val]) => {
                  setPanelVisible(key as any, !isProfileActive ? val : false);
                });
              }}
              style={{ padding: "2px 6px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
            >
              <input type="checkbox" checked={isProfileActive} readOnly style={{ margin: 0, width: 10, height: 10 }} />
              {p.label}
            </button>
          );
        })}
      </div>

      {/* ── Connection status (right-aligned) ── */}
      <ConnectionStatus />

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── External links ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <a
          href="https://x.com/zadescoxp"
          target="_blank"
          rel="noopener noreferrer"
          className="btn"
          style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px" }}
          title="X / Twitter"
        >
          𝕏 @zadescoxp
        </a>
        <a
          href="https://github.com/zadescoxp/order-flow-screener"
          target="_blank"
          rel="noopener noreferrer"
          className="btn"
          style={{ padding: "2px 8px", display: "flex", alignItems: "center", gap: 6 }}
          title="Contribute"
        >
          <img
            src="https://cdn.pixabay.com/photo/2022/01/30/13/33/github-6980894_640.png"
            alt="GitHub"
            style={{ width: 14, height: 14, objectFit: "contain", filter: "invert(1)" }}
          />
          <span style={{ fontSize: 11, fontWeight: 600 }}>Contribute</span>
        </a>
      </div>
    </div>
  );
}
