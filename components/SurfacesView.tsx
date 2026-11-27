"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMarketSession, useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { venuesForSelection } from "@/lib/adapters/capabilities";
import { readPalette, monoFont, type Palette } from "@/hooks/useCanvas";
import { formatClock, formatCompact, formatPriceValue, formatSigned, priceDecimals, VENUE_LABEL } from "@/lib/format";
import {
  buildFlowFrame,
  buildFundingFrame,
  buildLiquidationFrame,
  buildLiquidityFrame,
  LEVERAGE_TIERS,
  MAINTENANCE_MARGIN,
  SURFACE_CAPACITY,
  SURFACE_INTERVAL_MS,
  type FlowMetric,
  type FundingMetric,
  type SurfaceEngine,
  type SurfaceFrame,
  type SurfaceKind,
} from "@/lib/engine/surfaces";
import {
  backWalls,
  colX,
  eyePosition,
  HEAT_STOPS,
  hexToRgb,
  mix,
  ramp,
  rowZ,
  SurfaceRenderer,
  type AxisTicks,
  type Camera,
  type RGB,
  type SurfaceMesh,
  type Vec3,
} from "@/lib/render/surface3d";
import { Info } from "lucide-react";
import { Icon } from "@/components/ui/Icons";
import { Button, Panel, Segmented, Stat } from "@/components/ui/Primitives";
import type { Venue } from "@/lib/types/market";

// ─── 3D Surfaces ─────────────────────────────────────────────────
// A full-window view with four time × Y × Z surfaces that build in real
// time from the live feed (or a replay). Pick one on the left; drag to
// orbit, scroll to zoom, hover for values.

interface SurfaceMeta {
  kind: SurfaceKind;
  title: string;
  y: string;
  z: string;
  use: string;
  source: "Live" | "Model";
  note: string;
}

export const SURFACES: SurfaceMeta[] = [
  {
    kind: "liquidity",
    title: "Order book liquidity",
    y: "Distance from mid",
    z: "Cumulative depth",
    use: "Slippage estimation & spoofing detection",
    source: "Live",
    note: "Every venue's book, summed and accumulated outward from the mid each second. Bids sit on the near side, asks on the far side. A wall that appears and disappears as price approaches is a ridge that comes and goes.",
  },
  {
    kind: "liquidation",
    title: "Liquidation clusters",
    y: "Price level",
    z: "Est. liquidation size",
    use: "Cascade levels & stop-hunt targets",
    source: "Model",
    note: `Exchanges don't publish open positions, so this is an estimate. Each second's rise in open interest opens longs and shorts at that price, spread across ${LEVERAGE_TIERS.map((t) => `${t.leverage}×`).join(" / ")} leverage (${(MAINTENANCE_MARGIN * 100).toFixed(1)}% maintenance margin), leaning toward the aggressor. A fall in OI shrinks every level, and price trading through a level clears it. It starts empty and builds from when you connected.`,
  },
  {
    kind: "funding",
    title: "Funding & basis",
    y: "Venue",
    z: "Annualized yield",
    use: "Delta-neutral carry & cross-venue arbitrage",
    source: "Live",
    note: "Each venue's current (predicted) funding rate restated as an annual yield, or its mark-to-index premium. Dated-futures tenors aren't streamed, so the Y axis is venue only. It works best with All perps selected.",
  },
  {
    kind: "flow",
    title: "OI / volume profile",
    y: "Price bins",
    z: "Net Δ OI / volume",
    use: "Institutional accumulation vs. distribution",
    source: "Live",
    note: "Each second's change in open interest is placed at the prices that traded in that second, in proportion to their volume. Cumulative mode builds the profile across the window. A ridge of rising OI that holds at a level is positioning; one that falls away is unwinding.",
  },
];

const WINDOWS = [
  { value: 120_000, label: "2m" },
  { value: 300_000, label: "5m" },
  { value: 900_000, label: "15m" },
  { value: SURFACE_CAPACITY * SURFACE_INTERVAL_MS, label: "30m" },
] as const;

type ViewPreset = "orbit" | "top" | "front" | "side";
const PRESETS: Record<ViewPreset, Camera> = {
  orbit: { yaw: -0.72, pitch: 0.52, distance: 4.1 },
  top: { yaw: 0, pitch: 1.5, distance: 4.0 },
  front: { yaw: 0, pitch: 0.06, distance: 4.2 },
  side: { yaw: -Math.PI / 2, pitch: 0.06, distance: 4.2 },
};

type Scale = "linear" | "sqrt";

interface Built {
  frame: SurfaceFrame;
  venues: Venue[];
  rowLabel: (row: number) => string;
  /** Axis label for a (round) row value; categorical surfaces label rows instead. */
  axisLabel?: (value: number) => string;
  valueLabel: (value: number) => string;
  /** Extra tooltip line for a row (e.g. the price a bps distance maps to). */
  rowDetail?: (row: number, col: number) => string | null;
  yTitle: string;
  zTitle: string;
  categorical: boolean;
}

function surfaceAvailability(kind: SurfaceKind, marketType: string): string | null {
  if (marketType === "forex") return "FX feeds carry quotes only, with no order book, open interest or funding. Pick a crypto market.";
  if ((kind === "liquidation" || kind === "funding") && marketType !== "perpetual") return "This surface needs a perpetual market (open interest and funding).";
  return null;
}

export default function SurfacesView() {
  const session = useMarketSession();
  const engine = session.manager.surfaces;
  const storedKind = useUIStore((s) => s.surface);
  const setSurface = useUIStore((s) => s.setSurface);
  const kind: SurfaceKind = SURFACES.some((s) => s.kind === storedKind) ? storedKind : "liquidity";
  const meta = SURFACES.find((s) => s.kind === kind)!;

  const marketType = useSessionStore((s) => s.marketType);
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const tickSize = useSessionStore((s) => s.tickSize);
  const replaying = useSessionStore((s) => s.replay !== null);
  const setMarketType = useSessionStore((s) => s.setMarketType);
  const setVenue = useSessionStore((s) => s.setVenue);
  const setSelectedVenues = useSessionStore((s) => s.setSelectedVenues);

  const [windowMs, setWindowMs] = useState<number>(300_000);
  const [scale, setScale] = useState<Scale>("linear");
  const [bandBps, setBandBps] = useState(50);
  const [rangePct, setRangePct] = useState(5);
  const [flowMetric, setFlowMetric] = useState<FlowMetric>("doi");
  const [cumulative, setCumulative] = useState(true);
  const [fundingMetric, setFundingMetric] = useState<FundingMetric>("apr");
  const [latest, setLatest] = useState<Built | null>(null);

  const effectiveFlowMetric: FlowMetric = marketType !== "perpetual" && flowMetric === "doi" ? "volume" : flowMetric;
  const unavailable = surfaceAvailability(kind, marketType);

  const build = useCallback((): Built => {
    const now = engine.lastTime || Date.now();
    const spec = { windowMs, now };
    const priceLabel = (price: number) => formatPriceValue(price, priceDecimals(tickSize, price));
    const priceRow = (frame: SurfaceFrame) => (row: number) => priceLabel(frame.rowValues[row]);
    if (kind === "liquidity") {
      const frame = buildLiquidityFrame(engine, { ...spec, bandBps });
      return {
        frame,
        venues: [],
        rowLabel: (row) => `${frame.rowValues[row] > 0 ? "+" : ""}${frame.rowValues[row]} bps`,
        axisLabel: (bps) => `${bps > 0 ? "+" : ""}${Math.round(bps)} bps`,
        valueLabel: (v) => `$${formatCompact(v)}`,
        rowDetail: (row) => {
          const mid = engine.liquidity.last?.mid;
          const bps = frame.rowValues[row];
          if (!mid) return null;
          const price = mid * (1 + bps / 1e4);
          return `${bps < 0 ? "Bids" : bps > 0 ? "Asks" : "Mid"} to ${formatPriceValue(price, priceDecimals(tickSize, price))}`;
        },
        yTitle: "Distance from mid",
        zTitle: "Cumulative depth",
        categorical: false,
      };
    }
    if (kind === "liquidation") {
      const frame = buildLiquidationFrame(engine, { ...spec, rangePct });
      return {
        frame,
        venues: [],
        rowLabel: priceRow(frame),
        axisLabel: priceLabel,
        valueLabel: (v) => `$${formatCompact(v)}`,
        yTitle: "Price",
        zTitle: "Est. liquidations",
        categorical: false,
      };
    }
    if (kind === "funding") {
      const { frame, venues } = buildFundingFrame(engine, { ...spec, metric: fundingMetric });
      return {
        frame,
        venues,
        rowLabel: (row) => VENUE_LABEL[venues[row]] ?? venues[row] ?? "",
        valueLabel: (v) => (fundingMetric === "apr" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : `${v > 0 ? "+" : ""}${v.toFixed(2)} bps`),
        yTitle: "Venue",
        zTitle: fundingMetric === "apr" ? "Funding APR" : "Mark premium",
        categorical: true,
      };
    }
    const frame = buildFlowFrame(engine, { ...spec, metric: effectiveFlowMetric, cumulative });
    return {
      frame,
      venues: [],
      rowLabel: priceRow(frame),
      axisLabel: priceLabel,
      valueLabel: (v) => (effectiveFlowMetric === "volume" ? `$${formatCompact(v)}` : `${formatSigned(v)}`.replace(/^([+-]?)/, "$1$")),
      yTitle: "Price",
      zTitle: effectiveFlowMetric === "doi" ? "Net Δ OI" : effectiveFlowMetric === "delta" ? "Delta" : "Volume",
      categorical: false,
    };
  }, [engine, kind, windowMs, bandBps, rangePct, fundingMetric, effectiveFlowMetric, cumulative, tickSize]);

  const aggregateAllPerps = () => {
    setVenue("all-perps");
    setSelectedVenues(venuesForSelection("all-perps", "perpetual", symbol));
  };

  const multiVenue = selectedVenues.length > 1 || venue === "all-perps";

  const controls = (
    <>
      {kind === "liquidity" && (
        <Segmented size="xs" value={bandBps} onChange={setBandBps} ariaLabel="Depth band"
          options={[{ value: 10, label: "±10" }, { value: 25, label: "±25" }, { value: 50, label: "±50" }, { value: 100, label: "±100 bps" }]} />
      )}
      {kind === "liquidation" && (
        <Segmented size="xs" value={rangePct} onChange={setRangePct} ariaLabel="Price range"
          options={[{ value: 1, label: "±1%" }, { value: 2, label: "±2%" }, { value: 5, label: "±5%" }, { value: 10, label: "±10%" }]} />
      )}
      {kind === "funding" && (
        <Segmented size="xs" value={fundingMetric} onChange={setFundingMetric} ariaLabel="Funding metric"
          options={[{ value: "apr", label: "Funding APR", title: "Funding rate, annualized" }, { value: "premium", label: "Premium", title: "(mark − index) / index, bps" }]} />
      )}
      {kind === "flow" && (
        <>
          <Segmented size="xs" value={effectiveFlowMetric} onChange={setFlowMetric} ariaLabel="Profile metric"
            options={[
              { value: "doi", label: "Δ OI", disabled: marketType !== "perpetual", title: marketType !== "perpetual" ? "Open interest needs a perpetual market" : "Net change in open interest" },
              { value: "volume", label: "Volume" },
              { value: "delta", label: "Delta" },
            ]} />
          <Segmented size="xs" value={cumulative ? "cum" : "slice"} onChange={(v) => setCumulative(v === "cum")} ariaLabel="Accumulation"
            options={[{ value: "cum", label: "Cumulative" }, { value: "slice", label: "Per slice" }]} />
        </>
      )}
      <Segmented size="xs" value={scale} onChange={setScale} ariaLabel="Height scale"
        options={[{ value: "linear", label: "Lin", title: "Linear height" }, { value: "sqrt", label: "√", title: "Square-root height: lifts small features" }]} />
      <Segmented size="xs" accent value={windowMs} onChange={setWindowMs} options={WINDOWS} ariaLabel="Time window" />
    </>
  );

  return (
    <div className="surfaces-view">
      <nav className="surfaces-rail" aria-label="3D surfaces">
        <div className="surfaces-rail-head">
          <span className="panel-icon"><Icon.Box /></span>
          <div>
            <strong>3D Surfaces</strong>
            <small>{replaying ? "Building from the replay" : "Building in real time"}</small>
          </div>
        </div>
        {SURFACES.map((surface) => {
          const blocked = surfaceAvailability(surface.kind, marketType);
          return (
            <button
              key={surface.kind}
              type="button"
              className={`surface-card${surface.kind === kind ? " is-active" : ""}${blocked ? " is-blocked" : ""}`}
              aria-pressed={surface.kind === kind}
              onClick={() => setSurface(surface.kind)}
            >
              <span className="surface-card-top">
                <strong>{surface.title}</strong>
                <span className={`surface-badge ${surface.source === "Model" ? "is-model" : ""}`}>{blocked ? "Perps" : surface.source}</span>
              </span>
              <span className="surface-axes">
                <span><em>X</em>Time</span>
                <span><em>Y</em>{surface.y}</span>
                <span><em>Z</em>{surface.z}</span>
              </span>
              <span className="surface-use">{surface.use}</span>
            </button>
          );
        })}
        <p className="surfaces-help">Drag to orbit · scroll to zoom · double-click to reset · hover for values</p>
      </nav>

      <Panel
        className="surfaces-stage"
        icon={<Icon.Box />}
        title={meta.title}
        subtitle={`X time · Y ${meta.y.toLowerCase()} · Z ${meta.z.toLowerCase()}`}
        value={
          <span className="surface-title-extras">
            {meta.source === "Model" && <span className="surface-badge is-model">Model</span>}
            <SurfaceInfo title={meta.title} text={meta.note} use={meta.use} />
          </span>
        }
        actions={controls}
      >
        {unavailable ? (
          <div className="surface-empty">
            <p>{unavailable}</p>
            {marketType !== "perpetual" && (
              <Button className="is-primary" onClick={() => setMarketType("perpetual")} disabled={replaying}>Switch to perpetuals</Button>
            )}
          </div>
        ) : (
          <>
            <SurfaceStats kind={kind} built={latest} engine={engine} tickSize={tickSize} />
            {kind === "funding" && !multiVenue && (
              <div className="surface-banner">
                One venue gives a single ribbon. Aggregate every perp venue to compare carry across exchanges.
                <Button className="chip is-primary" onClick={aggregateAllPerps} disabled={replaying}>Use All perps</Button>
              </div>
            )}
            <SurfaceCanvas key={kind} engine={engine} build={build} scale={scale} onFrame={setLatest} />
          </>
        )}
      </Panel>
    </div>
  );
}

// ─── Info popover ────────────────────────────────────────────────
// How the surface is built, kept behind an icon so the plot has the room.
function SurfaceInfo({ title, text, use }: { title: string; text: string; use: string }) {
  return (
    <span className="surface-info">
      <button type="button" className="surface-info-button" aria-label={`About ${title}`} aria-describedby="surface-info-text">
        <Info size={14} strokeWidth={1.9} aria-hidden />
      </button>
      <span className="surface-info-pop" role="tooltip" id="surface-info-text">
        <strong>{title}</strong>
        <span>{text}</span>
        <em>{use}</em>
      </span>
    </span>
  );
}

// ─── Stats strip ─────────────────────────────────────────────────
function lastColumn(frame: SurfaceFrame): number {
  for (let c = frame.cols - 1; c >= frame.firstCol; c--) {
    if (Number.isFinite(frame.values[c * frame.rows])) return c;
  }
  return -1;
}

function SurfaceStats({ kind, built, engine, tickSize }: { kind: SurfaceKind; built: Built | null; engine: SurfaceEngine; tickSize: number }) {
  if (!built || built.frame.kind !== kind) return <div className="surface-stats" />;
  const { frame } = built;
  const c = lastColumn(frame);
  if (c < 0) return <div className="surface-stats"><Stat label="Status" value="Waiting for data" tone="muted" /></div>;
  const at = (col: number, row: number) => frame.values[col * frame.rows + row];
  const price = (p: number) => formatPriceValue(p, priceDecimals(tickSize, p));

  if (kind === "liquidity") {
    const bids = at(c, 0);
    const asks = at(c, frame.rows - 1);
    const imbalance = bids + asks > 0 ? (bids - asks) / (bids + asks) : 0;
    // Depth change at the band edge over ~30 s: liquidity pulled or added.
    const span = Math.max(1, Math.round(30_000 / ((frame.t1 - frame.t0) / frame.cols)));
    const p = Math.max(frame.firstCol, c - span);
    const before = at(p, 0) + at(p, frame.rows - 1);
    const change = before > 0 ? ((bids + asks - before) / before) * 100 : 0;
    const band = Math.abs(frame.rowValues[0]);
    return (
      <div className="surface-stats">
        <Stat label={`Bids within ${band} bps`} value={`$${formatCompact(bids)}`} tone="buy" />
        <Stat label={`Asks within ${band} bps`} value={`$${formatCompact(asks)}`} tone="sell" />
        <Stat label="Imbalance" value={`${imbalance > 0 ? "+" : ""}${(imbalance * 100).toFixed(1)}%`} tone={imbalance > 0.1 ? "buy" : imbalance < -0.1 ? "sell" : "muted"} />
        <Stat label="Depth Δ 30s" value={`${change > 0 ? "+" : ""}${change.toFixed(1)}%`} tone={change < -15 ? "warn" : "muted"} title="A sharp drop is liquidity being pulled, a common spoofing tell" />
      </div>
    );
  }
  if (kind === "liquidation") {
    const current = engine.liquidation.last?.price ?? 0;
    let longBest = -1, shortBest = -1, total = 0;
    for (let r = 0; r < frame.rows; r++) {
      const v = at(c, r);
      total += v;
      if (frame.rowValues[r] < current && (longBest < 0 || v > at(c, longBest))) longBest = r;
      if (frame.rowValues[r] > current && (shortBest < 0 || v > at(c, shortBest))) shortBest = r;
    }
    const distance = (r: number) => `${(((frame.rowValues[r] - current) / current) * 100).toFixed(2)}%`;
    return (
      <div className="surface-stats">
        <Stat label="Largest long cluster" value={longBest >= 0 && at(c, longBest) > 0 ? price(frame.rowValues[longBest]) : "—"} sub={longBest >= 0 && at(c, longBest) > 0 ? `$${formatCompact(at(c, longBest))} · ${distance(longBest)}` : undefined} tone="sell" />
        <Stat label="Largest short cluster" value={shortBest >= 0 && at(c, shortBest) > 0 ? price(frame.rowValues[shortBest]) : "—"} sub={shortBest >= 0 && at(c, shortBest) > 0 ? `$${formatCompact(at(c, shortBest))} · +${distance(shortBest)}` : undefined} tone="buy" />
        <Stat label="Est. in range" value={`$${formatCompact(total)}`} tone="muted" />
      </div>
    );
  }
  if (kind === "funding") {
    const values = built.venues.map((venue, r) => ({ venue, v: at(c, r) })).filter((x) => Number.isFinite(x.v));
    if (!values.length) return <div className="surface-stats" />;
    const sorted = [...values].sort((a, b) => b.v - a.v);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    const mean = values.reduce((sum, x) => sum + x.v, 0) / values.length;
    return (
      <div className="surface-stats">
        <Stat label="Highest" value={built.valueLabel(hi.v)} sub={VENUE_LABEL[hi.venue] ?? hi.venue} tone={hi.v >= 0 ? "buy" : "sell"} />
        <Stat label="Lowest" value={built.valueLabel(lo.v)} sub={VENUE_LABEL[lo.venue] ?? lo.venue} tone={lo.v >= 0 ? "buy" : "sell"} />
        <Stat label="Cross-venue spread" value={built.valueLabel(hi.v - lo.v).replace(/^\+/, "")} title="Short the highest, long the lowest" tone="poc" />
        <Stat label="Mean" value={built.valueLabel(mean)} tone="muted" />
      </div>
    );
  }
  let peak = 0, net = 0;
  for (let r = 0; r < frame.rows; r++) {
    const v = at(c, r);
    net += v;
    if (Math.abs(v) > Math.abs(at(c, peak))) peak = r;
  }
  return (
    <div className="surface-stats">
      <Stat label="Peak level" value={price(frame.rowValues[peak])} sub={built.valueLabel(at(c, peak))} tone={at(c, peak) >= 0 ? "buy" : "sell"} />
      <Stat label="Window total" value={built.valueLabel(net)} tone={frame.signed ? (net >= 0 ? "buy" : "sell") : "muted"} />
    </div>
  );
}

// ─── Canvas ──────────────────────────────────────────────────────
interface MeshInfo {
  max: number;
  signed: boolean;
  split: boolean;
}

function robustMax(frame: SurfaceFrame): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(((frame.cols - frame.firstCol) * frame.rows) / 6000));
  for (let i = frame.firstCol * frame.rows; i < frame.values.length; i += step) {
    const v = Math.abs(frame.values[i]);
    if (Number.isFinite(v) && v > 0) sample.push(v);
  }
  if (!sample.length) return 1;
  sample.sort((a, b) => a - b);
  // A single spike shouldn't flatten everything else.
  return sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.995))] || 1;
}

const UNSIGNED_TOP = 0.9;
const SIGNED_HALF = 0.45;

function toMesh(frame: SurfaceFrame, scale: Scale, palette: Palette): { mesh: SurfaceMesh; info: MeshInfo } {
  const { cols, rows, firstCol, signed } = frame;
  const max = robustMax(frame);
  const heights = new Float32Array(cols * rows);
  const colors = new Float32Array(cols * rows * 3);
  const buy = hexToRgb(palette.buy, [0.24, 0.81, 0.56]);
  const sell = hexToRgb(palette.sell, [0.96, 0.34, 0.42]);
  const neutral: RGB = palette.light ? [0.8, 0.81, 0.84] : [0.22, 0.23, 0.27];
  const split = frame.splitRow >= 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = c * rows + r;
      const raw = frame.values[i];
      const v = Number.isFinite(raw) ? raw : 0;
      let n = Math.max(-1, Math.min(1, v / max));
      if (scale === "sqrt") n = Math.sign(n) * Math.sqrt(Math.abs(n));
      heights[i] = signed ? 0.5 + n * SIGNED_HALF : Math.max(0, n) * UNSIGNED_TOP;
      let color: RGB;
      if (signed) color = n >= 0 ? mix(neutral, buy, 0.25 + 0.75 * n) : mix(neutral, sell, 0.25 + 0.75 * -n);
      else if (split) {
        const side = r < frame.splitRow ? buy : r > frame.splitRow ? sell : neutral;
        color = mix(mix(neutral, side, 0.35), mix(side, [1, 1, 1], 0.25), n);
      } else color = ramp(HEAT_STOPS, n);
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }
  }
  return {
    mesh: { cols, rows, firstCol, heights, colors, path: frame.path, baseY: signed ? 0.5 : 0 },
    info: { max, signed, split },
  };
}

/** Heights of the y gridlines and the value each one stands for. */
function heightTicks(info: MeshInfo, scale: Scale): { y: number; value: number }[] {
  const unscale = (n: number) => (scale === "sqrt" ? Math.sign(n) * n * n : n) * info.max;
  if (info.signed) return [-1, -0.5, 0, 0.5, 1].map((n) => ({ y: 0.5 + n * SIGNED_HALF, value: unscale(n) }));
  return [0, 0.25, 0.5, 0.75, 1].map((n) => ({ y: n * UNSIGNED_TOP, value: unscale(n) }));
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10) * power;
}

/** Y-axis ticks: a fractional row and its label (round values, or every category). */
function rowTicks(built: Built): { row: number; label: string }[] {
  const { frame } = built;
  if (built.categorical || !built.axisLabel) return Array.from({ length: frame.rows }, (_, r) => ({ row: r, label: built.rowLabel(r) }));
  const v0 = frame.rowValues[0];
  const v1 = frame.rowValues[frame.rows - 1];
  if (!(v1 > v0)) return [];
  const step = niceStep(v1 - v0, 5);
  const per = (v1 - v0) / (frame.rows - 1);
  const out: { row: number; label: string }[] = [];
  for (let v = Math.ceil(v0 / step) * step; v <= v1 + 1e-9; v += step) out.push({ row: (v - v0) / per, label: built.axisLabel(v) });
  return out;
}

const TIME_STEPS = [10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

function timeTicks(frame: SurfaceFrame): number[] {
  const span = frame.t1 - frame.t0;
  const step = TIME_STEPS.find((s) => span / s <= 6) ?? 600_000;
  const out: number[] = [];
  for (let t = Math.ceil(frame.t0 / step) * step; t <= frame.t1; t += step) out.push(t);
  return out;
}

/** World x of a timestamp (vertex c stands for the end of its column). */
function timeX(frame: SurfaceFrame, t: number): number {
  const dt = (frame.t1 - frame.t0) / frame.cols;
  return colX((t - frame.t0) / dt - 1, frame.cols);
}

function SurfaceCanvas({
  engine,
  build,
  scale,
  onFrame,
}: {
  engine: SurfaceEngine;
  build: () => Built;
  scale: Scale;
  onFrame: (built: Built) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SurfaceRenderer | null>(null);
  const cameraRef = useRef<Camera>({ ...PRESETS.orbit });
  const builtRef = useRef<Built | null>(null);
  const infoRef = useRef<MeshInfo | null>(null);
  const hoverRef = useRef<{ col: number; row: number } | null>(null);
  const frameRequest = useRef<number | null>(null);
  const buildRef = useRef(build);
  const scaleRef = useRef(scale);
  const onFrameRef = useRef(onFrame);
  const [unsupported, setUnsupported] = useState(false);
  const [preset, setPreset] = useState<ViewPreset | null>("orbit");
  const [spin, setSpin] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    buildRef.current = build;
    scaleRef.current = scale;
    onFrameRef.current = onFrame;
  }, [build, scale, onFrame]);

  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const built = builtRef.current;
    const info = infoRef.current;
    if (!overlay || !container || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(width * dpr) || overlay.height !== Math.round(height * dpr)) {
      overlay.width = Math.round(width * dpr);
      overlay.height = Math.round(height * dpr);
    }
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!built || !info) return;
    const palette = readPalette();
    const { frame } = built;
    const eye = eyePosition(cameraRef.current);
    const { backX, backZ } = backWalls(eye);
    const nearX = -backX;
    const nearZ = -backZ;
    const center = renderer.project([0, 0, 0]);

    const label = (p: Vec3, text: string, color = palette.textSecondary, push = 16, weight = 400) => {
      const s = renderer.project(p);
      if (s.w <= 0) return;
      const dx = s.x - center.x;
      const dy = s.y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.fillStyle = color;
      ctx.font = monoFont(10.5, weight);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, s.x + (dx / len) * push, s.y + (dy / len) * push);
    };

    // Time along the near floor edge.
    for (const t of timeTicks(frame)) {
      const x = timeX(frame, t);
      if (x < -1.001 || x > 1.001) continue;
      label([x, 0, nearZ], formatClock(t).slice(0, t % 60_000 === 0 ? 5 : 8));
    }
    // Y (rows) along the near side edge.
    const rows = renderer.meshRows || frame.rows;
    for (const tick of rowTicks(built)) {
      if (tick.row < -0.01 || tick.row > frame.rows - 0.99) continue;
      const z = frame.rows < 2 ? 0 : rowZ(tick.row, rows);
      label([nearX, 0, z], tick.label, palette.textSecondary, 30);
    }
    // Z (values) up the near corner of the side wall.
    for (const tick of heightTicks(info, scaleRef.current)) {
      label([backX, tick.y, nearZ], built.valueLabel(tick.value), palette.textMuted, 26);
    }
    // Axis titles.
    // Titles sit past the end of their axis so they never collide with a tick.
    label([1.22, 0, nearZ], "Time", palette.text, 18, 600);
    label([nearX, 0, 0], built.yTitle, palette.text, 76, 600);
    label([backX, 1.08, nearZ], built.zTitle, palette.text, 12, 600);

    // Hover marker.
    const hover = hoverRef.current;
    if (hover) {
      const mesh = frame;
      const raw = mesh.values[hover.col * mesh.rows + hover.row];
      if (Number.isFinite(raw)) {
        const ticks = heightTicks(info, scaleRef.current);
        let n = Math.max(-1, Math.min(1, raw / info.max));
        if (scaleRef.current === "sqrt") n = Math.sign(n) * Math.sqrt(Math.abs(n));
        const y = info.signed ? 0.5 + n * SIGNED_HALF : Math.max(0, n) * UNSIGNED_TOP;
        const z = frame.rows < 2 ? 0 : rowZ(hover.row, rows);
        const top = renderer.project([colX(hover.col, frame.cols), y, z]);
        const floor = renderer.project([colX(hover.col, frame.cols), info.signed ? ticks[2].y : 0, z]);
        ctx.strokeStyle = palette.text;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(floor.x, floor.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = palette.text;
        ctx.beginPath();
        ctx.arc(top.x, top.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  const draw = useCallback(() => {
    frameRequest.current = null;
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!renderer || !container) return;
    const palette = readPalette();
    const built = builtRef.current;
    const info = infoRef.current;
    const ticks: AxisTicks = { x: [], z: [], y: [] };
    if (built && info) {
      ticks.x = timeTicks(built.frame).map((t) => timeX(built.frame, t)).filter((x) => x >= -1 && x <= 1);
      const rows = renderer.meshRows || built.frame.rows;
      ticks.z = built.frame.rows < 2 ? [] : rowTicks(built).map((t) => rowZ(t.row, rows));
      ticks.y = heightTicks(info, scaleRef.current).map((t) => t.y).filter((y) => y > 0.001);
    }
    const line = hexToRgb(palette.textMuted, [0.4, 0.4, 0.42]);
    renderer.render(container.clientWidth, container.clientHeight, window.devicePixelRatio || 1, cameraRef.current, {
      line,
      lineAlpha: palette.light ? 0.35 : 0.3,
      wire: palette.light ? [0.1, 0.1, 0.12] : [0, 0, 0],
      wireAlpha: palette.light ? 0.14 : 0.32,
      trace: hexToRgb(palette.poc, [0.9, 0.83, 0.64]),
      zeroPlane: hexToRgb(palette.textSecondary, [0.6, 0.6, 0.65]),
    }, ticks);
    drawOverlay();
  }, [drawOverlay]);

  const requestDraw = useCallback(() => {
    if (frameRequest.current === null) frameRequest.current = requestAnimationFrame(draw);
  }, [draw]);

  const rebuild = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const built = buildRef.current();
    const { mesh, info } = toMesh(built.frame, scaleRef.current, readPalette());
    builtRef.current = built;
    infoRef.current = info;
    renderer.setMesh(mesh);
    const seconds = Math.max(0, built.frame.cols - built.frame.firstCol);
    setStatus(seconds < 2 ? "Building the surface. It fills in as each second of data arrives." : null);
    onFrameRef.current(built);
    requestDraw();
  }, [requestDraw]);

  // Renderer lifetime.
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    let renderer: SurfaceRenderer;
    try {
      renderer = new SurfaceRenderer(canvas);
    } catch {
      setUnsupported(true);
      return;
    }
    rendererRef.current = renderer;
    const observer = new ResizeObserver(() => requestDraw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [requestDraw]);

  // Rebuild when settings change, and whenever the engine gains a column.
  useEffect(() => {
    rebuild();
    let seen = engine.version;
    const timer = setInterval(() => {
      if (engine.version === seen) return;
      seen = engine.version;
      rebuild();
    }, 250);
    return () => clearInterval(timer);
  }, [engine, build, scale, theme, rebuild]);

  // Slow turntable.
  useEffect(() => {
    if (!spin) return;
    let last = performance.now();
    let id = requestAnimationFrame(function step(now) {
      cameraRef.current.yaw += ((now - last) / 1000) * 0.18;
      last = now;
      draw();
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [spin, draw]);

  const applyPreset = (next: ViewPreset) => {
    cameraRef.current = { ...PRESETS[next] };
    setPreset(next);
    setSpin(false);
    requestDraw();
  };

  const updateHover = (x: number, y: number) => {
    const renderer = rendererRef.current;
    const built = builtRef.current;
    if (!renderer || !built) return;
    const hit = renderer.pick(x, y);
    const previous = hoverRef.current;
    hoverRef.current = hit;
    if (!hit) {
      if (previous) requestDraw();
      setTooltip(null);
      return;
    }
    const { frame } = built;
    const value = frame.values[hit.col * frame.rows + hit.row];
    if (!Number.isFinite(value)) {
      setTooltip(null);
      return;
    }
    const dt = (frame.t1 - frame.t0) / frame.cols;
    const lines = [
      formatClock(frame.t0 + (hit.col + 1) * dt - SURFACE_INTERVAL_MS),
      `${built.yTitle}: ${built.rowLabel(hit.row)}`,
      `${built.zTitle}: ${built.valueLabel(value)}`,
    ];
    const detail = built.rowDetail?.(hit.row, hit.col);
    if (detail) lines.push(detail);
    setTooltip({ x, y, lines });
    requestDraw();
  };

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  if (unsupported) {
    return <div className="surface-empty"><p>3D surfaces need WebGL2, which this browser or GPU doesn&apos;t provide.</p></div>;
  }

  return (
    <div className="surface-canvas-wrap">
      <div
        ref={containerRef}
        className="surface-canvas"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          setTooltip(null);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (drag.current) {
            const dx = e.clientX - drag.current.x;
            const dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 1) drag.current.moved = true;
            drag.current.x = e.clientX;
            drag.current.y = e.clientY;
            const cam = cameraRef.current;
            cam.yaw -= dx * 0.008;
            cam.pitch = Math.max(0.02, Math.min(1.52, cam.pitch + dy * 0.006));
            setPreset(null);
            requestDraw();
            return;
          }
          updateHover(e.clientX - rect.left, e.clientY - rect.top);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => {
          hoverRef.current = null;
          setTooltip(null);
          requestDraw();
        }}
        onWheel={(e) => {
          const cam = cameraRef.current;
          cam.distance = Math.max(2.2, Math.min(8, cam.distance * Math.exp(e.deltaY * 0.0012)));
          requestDraw();
        }}
        onDoubleClick={() => applyPreset("orbit")}
      >
        <canvas ref={glRef} className="surface-gl" />
        <canvas ref={overlayRef} className="surface-overlay" />
        {status && <div className="surface-status">{status}</div>}
        {tooltip && (
          <div className="surface-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
            {tooltip.lines.map((line, i) => <div key={i} className={i === 0 ? "is-muted" : undefined}>{line}</div>)}
          </div>
        )}
      </div>
      <div className="surface-toolbar">
        <Segmented size="xs" value={preset ?? ("" as ViewPreset)} onChange={applyPreset} ariaLabel="Camera"
          options={[
            { value: "orbit", label: "3D", title: "Perspective view" },
            { value: "top", label: "Top", title: "From above: a heatmap of the surface" },
            { value: "front", label: "Front", title: "Along the Y axis: value over time" },
            { value: "side", label: "Side", title: "Along the time axis: the profile across Y" },
          ]} />
        <Button className={`chip${spin ? " is-active" : ""}`} onClick={() => setSpin((s) => !s)} aria-pressed={spin}>Rotate</Button>
      </div>
    </div>
  );
}
