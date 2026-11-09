"use client";

import Link from "next/link";
import { useSessionStore } from "@/lib/session/SessionContext";
import type { PanelVisibility, Timeframe, ToolProfile, Venue, VenueSelection } from "@/lib/types/market";
import { FOREX_SYMBOLS } from "@/lib/config/venues";
import { THEME_OPTIONS, type Theme } from "@/lib/theme";
import { venueSupports } from "@/lib/adapters/capabilities";
import { CRYPTO_ASSETS, CRYPTO_SYMBOLS } from "@/lib/config/instruments";
import { AssetLogo, VenueLogo } from "@/components/AssetLogo";
import { Picker, type PickerOption } from "@/components/ui/Picker";
import { useUIStore } from "@/lib/store/uiStore";
import { GitHubIcon, REPO_URL, Wordmark } from "@/components/Logo";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuCheckbox, MenuSection, Segmented, Select } from "@/components/ui/Primitives";
import AlertsMenu from "@/components/AlertsMenu";
import RecordingsMenu from "@/components/RecordingsMenu";
import ExportMenu from "@/components/ExportMenu";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1m", label: "1m" }, { value: "5m", label: "5m" }, { value: "15m", label: "15m" },
  { value: "30m", label: "30m" }, { value: "1h", label: "1H" }, { value: "4h", label: "4H" },
];
const PROFILES: { value: ToolProfile; label: string; title: string }[] = [
  { value: "order-flow", label: "Order Flow", title: "Footprint, tape, CVD and volume z-score" },
  { value: "liquidity", label: "Liquidity", title: "Order book, depth, imbalance and traded-volume heatmap" },
  { value: "volatility", label: "Volatility", title: "Realized volatility, volume z-score and tape" },
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
const PANEL_ITEMS: { key: keyof PanelVisibility; label: string; hint: string; group: "Chart" | "Studies" | "Sidebar" }[] = [
  { key: "volumeProfile", label: "Session profile", hint: "Volume by price beside the footprint", group: "Chart" },
  { key: "heatmap", label: "Traded-volume heatmap", hint: "Executed volume by price", group: "Chart" },
  { key: "cvd", label: "Cumulative delta", hint: "CVD with price overlay", group: "Studies" },
  { key: "volumeZ", label: "Volume z-score", hint: "Unusual participation", group: "Studies" },
  { key: "openInterest", label: "Open interest", hint: "OI with price and regime (perps)", group: "Studies" },
  { key: "liquidations", label: "Liquidations", hint: "Forced longs / shorts per bucket (perps)", group: "Studies" },
  { key: "venues", label: "Venues", hint: "Price, flow and lead / lag by venue", group: "Studies" },
  { key: "volatility", label: "Realized volatility", hint: "RV, ATR, Parkinson", group: "Studies" },
  { key: "depthOfMarket", label: "Market depth", hint: "Cumulative liquidity curve", group: "Studies" },
  { key: "orderBook", label: "Order book", hint: "Price ladder", group: "Sidebar" },
  { key: "obi", label: "Book imbalance", hint: "OBI gauge and history", group: "Sidebar" },
  { key: "timeSales", label: "Time & sales", hint: "Executed prints", group: "Sidebar" },
];

export default function TopBar() {
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const setSymbol = useSessionStore((s) => s.setSymbol);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSelectedVenues = useSessionStore((s) => s.setSelectedVenues);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setTimeframe = useSessionStore((s) => s.setTimeframe);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const panels = useUIStore((s) => s.panels);
  const toolProfile = useUIStore((s) => s.toolProfile);
  const setToolProfile = useUIStore((s) => s.setToolProfile);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  // During a replay the market is fixed by the recording.
  const replaying = useSessionStore((s) => s.replay !== null);

  const isForex = marketType === "forex";
  const instrumentOptions: PickerOption<string>[] = isForex
    ? FOREX_SYMBOLS.map((pair) => ({ value: pair, label: pair, sub: "Spot FX", icon: <AssetLogo symbol={pair} size={22} /> }))
    : CRYPTO_ASSETS.map((asset) => {
        const value = `${asset.base}USDT`;
        return {
          value,
          label: value,
          sub: asset.name,
          keywords: asset.base,
          icon: <AssetLogo symbol={value} size={22} />,
        };
      });
  const venueOptions = marketType === "perpetual" || marketType === "spot" ? VENUES[marketType] : [];
  const aggregateValue: VenueSelection = marketType === "perpetual" ? "all-perps" : "all-spot";

  const aggregateFor = (sym: string) =>
    venueOptions.filter((v) => venueSupports(v.value, sym, marketType)).map((v) => v.value);

  const chooseSymbol = (next: string) => {
    setSymbol(next);
    if (isForex) return;
    if (venue === aggregateValue) setSelectedVenues(aggregateFor(next));
    else if (!venueSupports(venue as Venue, next, marketType)) {
      // The current exchange doesn't list this coin: fall back to the first one that does.
      const fallback = venueOptions.find((v) => venueSupports(v.value, next, marketType));
      if (fallback) setVenue(fallback.value);
    }
  };

  const venuePickerOptions: PickerOption<VenueSelection>[] = [
    {
      value: aggregateValue,
      label: marketType === "perpetual" ? "All perps" : "All spot",
      sub: `Aggregated · ${aggregateFor(symbol).length} venues`,
      icon: <VenueLogo venue={aggregateValue} size={20} />,
    },
    ...venueOptions.map((v) => ({
      value: v.value as VenueSelection,
      label: v.label,
      sub: venueSupports(v.value, symbol, marketType) ? (marketType === "perpetual" ? "Perpetual" : "Spot") : `No ${symbol} market`,
      disabled: !venueSupports(v.value, symbol, marketType),
      icon: <VenueLogo venue={v.value} size={20} />,
    })),
  ];

  const chooseVenue = (next: VenueSelection) => {
    setVenue(next);
    if (next === aggregateValue) {
      setSelectedVenues(aggregateFor(symbol));
    }
  };

  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="orderflow home">
        <Wordmark size={28} />
      </Link>

      <fieldset className="topbar-market" disabled={replaying} title={replaying ? "Exit the replay to change the market" : undefined}>
      <div className="topbar-group">
        <Segmented
          value={marketType}
          onChange={(next) => {
            if (next === marketType) return;
            setMarketType(next);
            if (next === "forex") setSymbol("EUR/USD");
            else if (isForex || !CRYPTO_SYMBOLS.includes(symbol)) setSymbol("BTCUSDT");
          }}
          options={[
            { value: "perpetual", label: "Perp", title: "Crypto perpetual futures" },
            { value: "spot", label: "Spot", title: "Crypto spot" },
            { value: "forex", label: "FX", title: "Foreign exchange" },
          ]}
          ariaLabel="Market"
        />
      </div>

      <div className="topbar-group">
        <Picker
          searchable
          className="instrument-picker"
          value={symbol}
          options={instrumentOptions}
          onChange={chooseSymbol}
          ariaLabel="Instrument"
          width={300}
        />
        {!isForex && (
          <Picker
            value={venue}
            options={venuePickerOptions}
            onChange={chooseVenue}
            ariaLabel="Venue"
            width={260}
          />
        )}
      </div>

      <div className="topbar-group">
        <Segmented accent value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} ariaLabel="Candle interval" />
      </div>
      </fieldset>

      <div className="topbar-spacer" />

      <div className="topbar-group topbar-tools">
        <AlertsMenu />
        <RecordingsMenu />
        <ExportMenu />
      </div>

      <div className="topbar-group">
        <Segmented value={toolProfile} onChange={setToolProfile} options={PROFILES} ariaLabel="Workspace" />
        <Menu hint="Panels" label={<><Icon.Layout /><span className="hide-compact">Panels</span></>}>
          {(["Chart", "Studies", "Sidebar"] as const).map((group) => (
            <MenuSection key={group} title={group}>
              {PANEL_ITEMS.filter((item) => item.group === group).map((item) => (
                <MenuCheckbox
                  key={item.key}
                  checked={panels[item.key]}
                  onChange={(checked) => setPanelVisible(item.key, checked)}
                  label={item.label}
                  hint={item.hint}
                />
              ))}
            </MenuSection>
          ))}
        </Menu>
        <Select className="theme-select" value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
          {THEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>

      <a
        className="ui-button contribute-button is-primary"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contribute on GitHub"
        data-hint="Contribute on GitHub"
      >
        <GitHubIcon size={15} />
        <span className="contribute-label">Contribute</span>
      </a>
      <span className="topbar-break" aria-hidden />
    </header>
  );
}
