"use client";

import { useSessionStore } from "@/lib/session/SessionContext";
import type { MarketType, Timeframe, ToolProfile, Venue, VenueSelection } from "@/lib/types/market";
import { FOREX_SYMBOLS } from "@/lib/config/venues";
import type { Theme } from "@/lib/theme";
import { venueSupports } from "@/lib/adapters/capabilities";
import { useUIStore } from "@/lib/store/uiStore";
import { Badge, Button, Select } from "@/components/ui/Primitives";

const CRYPTO_PERPS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT", "OPUSDT"];
const CRYPTO_SPOT = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h"];
const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "forest", label: "Forest" },
  { value: "futuristic", label: "Futuristic" }, { value: "dark-dull", label: "Dark Dull" }, { value: "light-dull", label: "Light Dull" },
];
const PROFILES: { value: ToolProfile; label: string; icon: string }[] = [
  { value: "order-flow", label: "Flow", icon: "◈" },
  { value: "liquidity", label: "Liquidity", icon: "≋" },
  { value: "volatility", label: "Volatility", icon: "⌁" },
];
const VENUES: Record<"perpetual" | "spot", { value: Venue; label: string }[]> = {
  perpetual: [
    { value: "binance-futures", label: "Binance" }, { value: "bybit-futures", label: "Bybit" },
    { value: "okx-futures", label: "OKX" }, { value: "hyperliquid", label: "Hyperliquid" },
    { value: "bitget-futures", label: "Bitget" }, { value: "deribit", label: "Deribit" },
  ],
  spot: [
    { value: "binance-spot", label: "Binance" }, { value: "coinbase-spot", label: "Coinbase" },
    { value: "okx-spot", label: "OKX" }, { value: "bybit-spot", label: "Bybit" }, { value: "bitget-spot", label: "Bitget" },
  ],
};

function ConnectionStatus() {
  const connections = useSessionStore((s) => s.connections);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const venue = useSessionStore((s) => s.venue);
  const ticker = useSessionStore((s) => s.ticker);
  const live = selectedVenues.filter((v) => connections[v]?.status === "live").length;
  const status = connections[venue]?.status ?? (live ? "live" : "connecting");
  const stateFlag = connections[venue]?.stateFlag;
  return (
    <div className="topbar-status">
      <span className={`status-dot ${status}`} />
      <span>{stateFlag ?? (status === "live" ? "Live" : status)}</span>
      {ticker && <strong>{ticker.price.toLocaleString("en-US", { minimumFractionDigits: 1 })}</strong>}
    </div>
  );
}

export default function TopBar() {
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const setSymbol = useSessionStore((s) => s.setSymbol);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSelectedVenues = useSessionStore((s) => s.setSelectedVenues);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setTimeframe = useSessionStore((s) => s.setTimeframe);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const heatmapEnabled = useUIStore((s) => s.heatmap.tradedVolume);
  const setHeatmapVisible = useUIStore((s) => s.setHeatmapVisible);
  const panels = useUIStore((s) => s.panels);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  const isForex = marketType === "forex";
  const assets = isForex ? [...FOREX_SYMBOLS] : marketType === "perpetual" ? CRYPTO_PERPS : CRYPTO_SPOT;
  const venueOptions = marketType === "perpetual" || marketType === "spot" ? VENUES[marketType] : [];
  const aggregateValue: VenueSelection = marketType === "perpetual" ? "all-perps" : "all-spot";

  const toggleProfile = (profile: ToolProfile) => {
    const active = profile === "order-flow"
      ? panels.footprint && panels.orderBook && panels.tradesProfile
      : profile === "liquidity" ? panels.heatmap : panels.volatility;
    const target = profile === "order-flow"
      ? ["footprint", "orderBook", "volumeProfile", "depthOfMarket", "tradesProfile", "obi"]
      : profile === "liquidity" ? ["heatmap", "footprint", "depthOfMarket", "obi", "orderBook"] : ["volatility", "footprint", "volumeProfile"];
    target.forEach((panel) => setPanelVisible(panel as keyof typeof panels, !active));
  };

  return (
    <header className="modern-topbar">
      <div className="brand-lockup"><span className="brand-mark">⬡</span><div><strong>OFT</strong><small>ORDER FLOW TERMINAL</small></div></div>
      <div className="toolbar-divider" />
      <div className="toolbar-group">
        <label className="toolbar-label">Market</label>
        <Select value={isForex ? "forex" : "crypto"} onChange={(e) => {
          const next = e.target.value as "crypto" | "forex";
          setMarketType(next === "forex" ? "forex" : "perpetual");
          setSymbol(next === "forex" ? "EUR/USD" : "BTCUSDT");
        }} aria-label="Asset class">
          <option value="crypto">Crypto</option><option value="forex">Forex</option>
        </Select>
      </div>
      <div className="toolbar-group">
        <label className="toolbar-label">Instrument</label>
        <Select className="instrument-select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {assets.map((asset) => <option key={asset}>{asset}</option>)}
        </Select>
      </div>
      <div className="toolbar-group timeframe-group">
        <label className="toolbar-label">Interval</label>
        <div className="segmented-control">{TIMEFRAMES.map((tf) => <Button key={tf} className={timeframe === tf ? "is-active" : ""} onClick={() => setTimeframe(tf)}>{tf}</Button>)}</div>
      </div>
      {!isForex && <div className="toolbar-group venue-group">
        <label className="toolbar-label">Venue</label>
        <Select value={venue} onChange={(e) => {
          const next = e.target.value as VenueSelection;
          setVenue(next);
          if (next === aggregateValue) setSelectedVenues(venueOptions.filter((v) => venueSupports(v.value, symbol, marketType)).map((v) => v.value));
        }}>
          <option value={aggregateValue}>{marketType === "perpetual" ? "All perps" : "All spot"}</option>
          {venueOptions.map((v) => <option key={v.value} value={v.value} disabled={!venueSupports(v.value, symbol, marketType)}>{v.label}</option>)}
        </Select>
      </div>}
      <div className="toolbar-spacer" />
      <ConnectionStatus />
      <div className="toolbar-divider" />
      <div className="profile-pills">{PROFILES.map((profile) => {
        const active = profile.value === "order-flow" ? panels.footprint && panels.orderBook && panels.tradesProfile : profile.value === "liquidity" ? panels.heatmap : panels.volatility;
        return <Button key={profile.value} className={active ? "is-active" : ""} onClick={() => toggleProfile(profile.value)}><span>{profile.icon}</span>{profile.label}</Button>;
      })}</div>
      <Button className={heatmapEnabled ? "is-active accent-toggle" : "accent-toggle"} onClick={() => setHeatmapVisible("tradedVolume", !heatmapEnabled)}><span>▦</span>Heatmap</Button>
      <Select className="theme-select" value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
        {THEMES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </header>
  );
}
