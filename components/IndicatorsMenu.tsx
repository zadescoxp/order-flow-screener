"use client";

import { DEFAULT_INDICATORS, useUIStore, type IndicatorSettings } from "@/lib/store/uiStore";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuCheckbox, MenuSection, Segmented } from "@/components/ui/Primitives";

const SWATCHES = [null, "#a68bff", "#4f8cff", "#2fd897", "#ff9f43", "#ff5c74", "#f2f3f5"] as const;

function Swatches({
  value,
  onChange,
  label,
  fallback,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  fallback: string;
}) {
  return (
    <div className="menu-row">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {SWATCHES.map((color) => (
          <button
            key={color ?? "theme"}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={color ?? "Theme default"}
            title={color ?? "Theme default"}
            className={`swatch ${value === color ? "is-active" : ""} ${color === null ? "is-theme" : ""}`}
            style={{ background: color ?? fallback }}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="menu-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

export default function IndicatorsMenu() {
  const ind = useUIStore((s) => s.indicators);
  const set = useUIStore((s) => s.setIndicator);
  const reset = useUIStore((s) => s.resetIndicators);
  const toggle = (key: keyof IndicatorSettings, label: string, hint?: string) => (
    <MenuCheckbox checked={Boolean(ind[key])} onChange={(v) => set(key, v as never)} label={label} hint={hint} />
  );
  const changed = (Object.keys(DEFAULT_INDICATORS) as (keyof IndicatorSettings)[]).filter(
    (key) => ind[key] !== DEFAULT_INDICATORS[key]
  ).length;

  return (
    <Menu
      buttonClassName="chip"
      label={
        <>
          <Icon.Sliders />
          Indicators
          {changed > 0 && <span className="chip-count">{changed}</span>}
        </>
      }
    >
      <div className="indicators-menu">
        <MenuSection title="VWAP">
          {toggle("vwap", "Session VWAP", "Volume-weighted average price")}
          {toggle("vwapBands", "Deviation bands", "±1σ and ±2σ around VWAP")}
          <Swatches label="Colour" value={ind.vwapColor} onChange={(v) => set("vwapColor", v)} fallback="var(--vwap)" />
        </MenuSection>

        <MenuSection title="Session">
          {toggle("sessionPoc", "Point of control", "Highest-volume price of the session")}
          {toggle("valueArea", "Value area", "VAH / VAL lines and shading")}
          <Row label="Value area size">
            <Segmented
              size="xs"
              value={ind.valueAreaPct}
              onChange={(v) => set("valueAreaPct", v)}
              options={[{ value: 0.6, label: "60%" }, { value: 0.7, label: "70%" }, { value: 0.8, label: "80%" }]}
              ariaLabel="Value area size"
            />
          </Row>
          {toggle("sessionHighLow", "Session high / low")}
          <Swatches label="POC colour" value={ind.pocColor} onChange={(v) => set("pocColor", v)} fallback="var(--poc)" />
        </MenuSection>

        <MenuSection title="Footprint">
          {toggle("imbalances", "Imbalance highlights", "Bold bid/ask when one side dominates")}
          <Row label="Imbalance ratio">
            <Segmented
              size="xs"
              value={ind.imbalanceRatio}
              onChange={(v) => set("imbalanceRatio", v)}
              options={[{ value: 2, label: "2×" }, { value: 2.5, label: "2.5×" }, { value: 3, label: "3×" }, { value: 4, label: "4×" }]}
              ariaLabel="Imbalance ratio"
            />
          </Row>
          {toggle("stackedImbalances", "Stacked imbalances", "Consecutive imbalanced levels")}
          <Row label="Min stacked levels">
            <Segmented
              size="xs"
              value={ind.stackedLevels}
              onChange={(v) => set("stackedLevels", v)}
              options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
              ariaLabel="Minimum stacked levels"
            />
          </Row>
          {toggle("candlePoc", "Candle POC", "Outline each candle's busiest level")}
          {toggle("ohlcStrip", "Candle OHLC strip")}
          {toggle("summaryRows", "Summary rows", "Volume, delta, CVD and trades per candle")}
          {toggle("lastPrice", "Last price line")}
        </MenuSection>

        <MenuSection title="Bubbles">
          {toggle("bigTrades", "Big prints", "Large executed trades, sized by notional")}
          <Row label="Minimum size">
            <Segmented
              size="xs"
              value={ind.bigTradeRatio}
              onChange={(v) => set("bigTradeRatio", v)}
              options={[5, 10, 20, 50].map((n) => ({ value: n, label: `${n}×` }))}
              ariaLabel="Minimum big print size versus the average print"
            />
          </Row>
          {toggle("liquidations", "Liquidations", "Forced closes, ringed, sized by notional (perps)")}
        </MenuSection>

        <MenuSection title="Microstructure">
          {toggle("absorption", "Absorption", "Heavy aggressive volume at a price that held")}
          {toggle("icebergs", "Icebergs", "A level that kept refilling after trading through its size")}
        </MenuSection>

        <MenuSection title="Prior sessions">
          {toggle("priorDay", "Previous day levels", "Yesterday's POC, VAH, VAL and VWAP (UTC day)")}
          {toggle("nakedPocs", "Naked POCs", "Earlier days' POCs that price has not traded back to")}
        </MenuSection>

        <div className="menu-footer">
          <button type="button" className="ui-button chip" onClick={reset} disabled={!changed}>
            Reset to defaults
          </button>
        </div>
      </div>
    </Menu>
  );
}
