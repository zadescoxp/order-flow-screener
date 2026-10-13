"use client";

import React from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import type { Venue, VenueSelection, Timeframe, MarketType, ToolProfile } from "@/lib/types/market";
import { FOREX_SYMBOLS } from "@/lib/config/venues";
import type { Theme } from "@/lib/theme";
import { venueSupports } from "@/lib/adapters/capabilities";
import { useUIStore } from "@/lib/store/uiStore";

// ─── Theme options ───────────────────────────────────────────
const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "forest", label: "Forest" },
  { value: "futuristic", label: "Futuristic" },
  { value: "dark-dull", label: "Dark Dull" },
  { value: "light-dull", label: "Light Dull" },
];

// ─── Asset options ───────────────────────────────────────────
const ASSETS_PERP = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT"];
const ASSETS_SPOT = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const ASSETS_FOREX = [...FOREX_SYMBOLS];

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
const VENUES_FOREX: { value: Venue; label: string }[] = [
  { value: "oanda-forex", label: "OANDA" },
  { value: "polygon-forex", label: "Polygon" },
  { value: "finnhub-forex", label: "Finnhub" },
  { value: "mt5-forex", label: "MT5 bridge" },
];

const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h"];

const PROFILES: { value: ToolProfile; label: string }[] = [
  { value: "order-flow", label: "Order Flow" },
  { value: "liquidity", label: "Liquidity" },
  { value: "volatility", label: "Volatility" },
];

// ─── Status bar ───────────────────────────────────────────
function ConnectionStatus() {
  const connections = useSessionStore((s) => s.connections);
  const ticker = useSessionStore((s) => s.ticker);
  const venue = useSessionStore((s) => s.venue);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const selectedConnections = selectedVenues.map((selected) => connections[selected]).filter(Boolean);
  const liveCount = selectedConnections.filter((connection) => connection.status === "live").length;
  const status = venue === "all-perps" || venue === "all-spot" || venue === "all-forex"
    ? liveCount === selectedVenues.length && selectedVenues.length > 0 ? "live" : "connecting"
    : connections[venue]?.status ?? "connecting";
  const conn = connections[venue];

  return (
    <div className="flex items-center gap-3 ml-auto">
      <div className="flex items-center gap-2">
        <span
          className={`status-dot ${status}`}
          title={conn?.error ?? status}
        />
        <span
          style={{
            fontSize: 10,
            color: status === "live" ? "var(--buy)" : "var(--text-muted)",
          }}
        >
          {conn?.stateFlag ?? (status === "live"
            ? venue === "all-perps" || venue === "all-spot" || venue === "all-forex"
              ? `${liveCount}/${selectedVenues.length} LIVE`
              : "LIVE"
            : status === "connecting"
            ? "CONNECTING"
            : status.toUpperCase())}
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
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const toolProfile = useUIStore((s) => s.toolProfile);
  const ticker = useSessionStore((s) => s.ticker);

  const setSymbol = useSessionStore((s) => s.setSymbol);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSelectedVenues = useSessionStore((s) => s.setSelectedVenues);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setTimeframe = useSessionStore((s) => s.setTimeframe);
  const setToolProfile = useUIStore((s) => s.setToolProfile);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const heatmapEnabled = useUIStore((s) => s.heatmap.tradedVolume);
  const setHeatmapVisible = useUIStore((s) => s.setHeatmapVisible);

  const isForex = marketType === "forex";
  const assets = isForex ? ASSETS_FOREX : marketType === "perpetual" ? ASSETS_PERP : ASSETS_SPOT;
  const venues = isForex ? VENUES_FOREX : marketType === "perpetual" ? VENUES_PERP : VENUES_SPOT;
  const aggregateValue: VenueSelection = isForex ? "all-forex" : marketType === "perpetual" ? "all-perps" : "all-spot";
  const priceDigits = isForex ? 5 : 1;

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

      {/* ── Asset class ── */}
      <div className="select-wrap">
        <select
          className="terminal-select"
          value={isForex ? "forex" : "crypto"}
          onChange={(event) => {
            const nextClass = event.target.value as "crypto" | "forex";
            setMarketType(nextClass === "forex" ? "forex" : "perpetual");
            setSymbol(nextClass === "forex" ? "EUR/USD" : "BTCUSDT");
          }}
          id="asset-class-selector"
          aria-label="Asset class"
        >
          <option value="crypto">Crypto</option>
          <option value="forex">Forex</option>
        </select>
        <span className="select-arrow">▾</span>
      </div>

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
            {ticker.price.toLocaleString("en-US", { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}
          </span>
          <span style={{ fontSize: 10, color: changeColor }}>{changeStr}</span>
          <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
            O {ticker.open.toFixed(priceDigits)} H {ticker.high.toFixed(priceDigits)} L {ticker.low.toFixed(priceDigits)}
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
          {!isForex && <option value="perpetual">Perpetual</option>}
          {!isForex && <option value="spot">Spot</option>}
          {isForex && <option value="forex">Forex</option>}
        </select>
        <span className="select-arrow">▾</span>
      </div>

      <div className="topbar-sep" />

      {/* ── Venue ── */}
      <div className="select-wrap">
        <select
          className="terminal-select"
          value={venue}
          onChange={(e) => {
            const nextVenue = e.target.value as VenueSelection;
            setVenue(nextVenue);
            if (nextVenue === aggregateValue) {
              setSelectedVenues(
                venues
                  .filter((candidate) => venueSupports(candidate.value, symbol, marketType))
                  .map((candidate) => candidate.value)
              );
            }
          }}
          id="venue-selector"
        >
          <option value={aggregateValue}>
            {isForex ? "All Forex" : marketType === "perpetual" ? "All perps" : "All spot"}
          </option>
          {venues.map((v) => (
            <option
              key={v.value}
              value={v.value}
              disabled={!venueSupports(v.value, symbol, marketType)}
            >
              {v.label}
            </option>
          ))}
        </select>
        <span className="select-arrow">▾</span>
      </div>

      {(venue === "all-perps" || venue === "all-spot" || venue === "all-forex") && (
        <div style={{ display: "flex", gap: 2 }}>
          {venues.map((v) => {
            const enabled = selectedVenues.includes(v.value);
            return (
              <button
                key={v.value}
                className={`tab ${enabled ? "active" : ""}`}
                onClick={() => setSelectedVenues(
                  enabled
                    ? selectedVenues.filter((selected) => selected !== v.value)
                    : [...selectedVenues, v.value]
                )}
                title={`${enabled ? "Exclude" : "Include"} ${v.label}`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="topbar-sep" />

      {/* ── Tool Profile Toggles ── */}
      <div className="tab-group" style={{ display: "flex", gap: 2 }}>
        {PROFILES.map((p) => {
          const currentPanels = useUIStore.getState().panels;
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
                const setPanelVisible = useUIStore.getState().setPanelVisible;
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

      <button
        className={`tab ${heatmapEnabled ? "active" : ""}`}
        onClick={() => setHeatmapVisible("tradedVolume", !heatmapEnabled)}
        aria-pressed={heatmapEnabled}
        style={{ padding: "2px 6px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}
      >
        <input type="checkbox" checked={heatmapEnabled} readOnly style={{ margin: 0, width: 10, height: 10 }} />
        Heatmap
      </button>

      <div className="topbar-sep" />

      {/* ── Theme ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em" }}>🎨</span>
        <div className="select-wrap">
          <select
            className="terminal-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            id="theme-selector"
            style={{ color: "var(--text-accent)", fontWeight: 600 }}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="select-arrow">▾</span>
        </div>
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
          href="https://github.com"
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
