"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore, type FootprintMode, type IndicatorSettings } from "@/lib/store/uiStore";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import { formatClock, formatCompact, formatHM, formatPriceValue, formatSigned, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Button, Panel, Segmented } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import IndicatorsMenu from "./IndicatorsMenu";
import { ARRIVAL_SLACK_MS } from "@/lib/engine/derivatives";
import { imbalanceOf, stackedRuns } from "@/lib/engine/imbalance";
import { DEPTH_CAPACITY } from "@/lib/engine/depthHistory";
import { LiquidityHeatmapRenderer } from "@/lib/render/liquidityHeatmap";
import type { MicroEvent } from "@/lib/engine/microstructure";
import { useMarketSession } from "@/lib/session/SessionContext";
import { usePriorSessions } from "@/hooks/usePriorSessions";
import type { BigTrade, FootprintCandle, NormalizedLiquidation, VolumeProfile } from "@/lib/types/market";

type Bubble =
  | { x: number; y: number; r: number; kind: "liquidation"; liq: NormalizedLiquidation }
  | { x: number; y: number; r: number; kind: "trade"; trade: BigTrade };
const MAX_BUBBLES = 400;
const ICE = "#7dd3fc";

interface MicroHit {
  x: number;
  y: number;
  w: number;
  h: number;
  event: MicroEvent;
}

const shortDay = (day: number) => {
  const d = new Date(day);
  return `${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCDate().toString().padStart(2, "0")}`;
};

/** Index of the candle whose [openTime, closeTime] contains `time`, or -1. */
function candleIndexAt(candles: FootprintCandle[], time: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = candles[mid];
    if (time < c.openTime) hi = mid - 1;
    else if (time > c.closeTime) lo = mid + 1;
    else return mid;
  }
  return -1;
}

// ─── Footprint Chart ─────────────────────────────────────────────
// Price × time × executed volume. Each column is one candle; each row is
// one tick-sized price level on a contiguous ladder shared with the
// attached session volume profile on the left.

const AXIS_W = 76;
const HEADER_H = 20;
const SUMMARY_ROWS = ["Volume", "Delta", "CVD", "Trades"] as const;
const SUMMARY_ROW_H = 15;
const SUMMARY_H = SUMMARY_ROWS.length * SUMMARY_ROW_H;
const RIGHT_PAD = 28;
const STRIP_W = 7; // OHLC strip at the left of each column

const MODES: { value: FootprintMode; label: string; title: string }[] = [
  { value: "bidask", label: "Bid × Ask", title: "Sell volume (hit bid) × buy volume (lifted ask)" },
  { value: "delta", label: "Delta", title: "Buy minus sell volume per level" },
  { value: "volume", label: "Volume", title: "Total volume per level" },
];

interface View {
  scrollX: number; // px scrolled back in time from the live edge
  scrollY: number; // px from top of ladder to top of plot
  rowH: number;
  colW: number;
  followX: boolean;
  followY: boolean;
}

interface Layout {
  W: number;
  H: number;
  profileW: number;
  plotL: number;
  plotR: number;
  plotT: number;
  plotB: number;
  maxPrice: number;
  minPrice: number;
  tick: number;
  rows: number;
  colX: (index: number) => number;
  priceY: (price: number) => number;
  yPrice: (y: number) => number;
}

function heatColor(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [12, 34, 64], [20, 104, 160], [64, 190, 210], [250, 236, 160], [250, 160, 40], [230, 60, 40],
  ];
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f)) as [number, number, number];
}

export default function FootprintChart() {
  const candles = useSessionStore((s) => s.candles);
  const currentCandle = useSessionStore((s) => s.currentCandle);
  const tickSize = useSessionStore((s) => s.tickSize);
  const volumeProfile = useSessionStore((s) => s.volumeProfile);
  const session = useSessionStore((s) => s.session);
  const ticker = useSessionStore((s) => s.ticker);
  const symbol = useSessionStore((s) => s.symbol);
  const timeframe = useSessionStore((s) => s.timeframe);
  const venue = useSessionStore((s) => s.venue);
  const marketType = useSessionStore((s) => s.marketType);
  const liquidations = useSessionStore((s) => s.liquidations);
  const bigTrades = useSessionStore((s) => s.bigTrades);
  const microEvents = useSessionStore((s) => s.microEvents);
  const depthVersion = useSessionStore((s) => s.depthVersion);
  const marketSession = useMarketSession();
  const prior = usePriorSessions();
  const showLiquidity = useUIStore((s) => s.heatmap.restingLiquidity);
  const [liquidity] = React.useState(() => new LiquidityHeatmapRenderer(DEPTH_CAPACITY));
  const microRef = useRef<MicroHit[]>([]);
  const ind = useUIStore((s) => s.indicators);
  const setCrosshair = useSessionStore((s) => s.setCrosshair);
  const mode = useUIStore((s) => s.footprintMode);
  const setMode = useUIStore((s) => s.setFootprintMode);
  const showProfile = useUIStore((s) => s.panels.volumeProfile);
  const showHeatmap = useUIStore((s) => s.heatmap.tradedVolume);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  const setHeatmapVisible = useUIStore((s) => s.setHeatmapVisible);

  const allCandles = useMemo(
    () => (currentCandle ? [...candles, currentCandle] : candles),
    [candles, currentCandle]
  );

  const viewRef = useRef<View>({ scrollX: 0, scrollY: 0, rowH: 18, colW: 112, followX: true, followY: true });
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const bubblesRef = useRef<Bubble[]>([]);

  const decimals = priceDecimals(tickSize, ticker?.price);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      const view = viewRef.current;
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      layoutRef.current = null;
      bubblesRef.current = [];
      microRef.current = [];
      if (allCandles.length === 0) return;

      // ── Price ladder bounds ──
      const tick = tickSize;
      let maxPrice = -Infinity;
      let minPrice = Infinity;
      for (const candle of allCandles) {
        const prices = candle.sortedPrices;
        if (!prices.length) continue;
        if (prices[prices.length - 1] > maxPrice) maxPrice = prices[prices.length - 1];
        if (prices[0] < minPrice) minPrice = prices[0];
      }
      if (!Number.isFinite(maxPrice)) return;
      const rows = Math.round((maxPrice - minPrice) / tick) + 1;

      const profileW = showProfile ? Math.round(Math.min(150, Math.max(78, W * 0.12))) : 0;
      const plotL = profileW;
      const plotR = W - AXIS_W;
      const plotT = HEADER_H;
      const summaryH = ind.summaryRows ? SUMMARY_H : 0;
      const plotB = H - summaryH;
      const vwapColor = ind.vwapColor ?? p.vwap;
      const pocColor = ind.pocColor ?? p.poc;
      const plotW = plotR - plotL;
      const plotH = plotB - plotT;
      const { rowH, colW } = view;
      const totalH = rows * rowH;

      // ── Scroll state ──
      const contentW = allCandles.length * colW + RIGHT_PAD;
      const maxScrollX = Math.max(0, contentW - plotW + 40);
      if (view.followX) view.scrollX = 0;
      view.scrollX = Math.min(Math.max(0, view.scrollX), maxScrollX);
      const lastPrice = ticker?.price ?? allCandles[allCandles.length - 1].close;
      if (view.followY) {
        view.scrollY = totalH <= plotH
          ? (totalH - plotH) / 2
          : ((maxPrice - lastPrice) / tick) * rowH + rowH / 2 - plotH / 2;
      }
      view.scrollY = Math.min(Math.max(view.scrollY, -plotH / 2), Math.max(totalH - plotH / 2, -plotH / 2));

      const colX = (index: number) => plotR - RIGHT_PAD - (allCandles.length - index) * colW + view.scrollX;
      const priceY = (price: number) => plotT + ((maxPrice - price) / tick) * rowH - view.scrollY;
      const yPrice = (y: number) => maxPrice - Math.floor((y - plotT + view.scrollY) / rowH) * tick;
      layoutRef.current = { W, H, profileW, plotL, plotR, plotT, plotB, maxPrice, minPrice, tick, rows, colX, priceY, yPrice };

      const firstRow = Math.max(0, Math.floor(view.scrollY / rowH));
      const lastRow = Math.min(rows - 1, Math.ceil((view.scrollY + plotH) / rowH));

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotL, plotT, plotW, plotH);
      ctx.clip();

      // ── Resting-liquidity heatmap (order-book depth over time) ──
      // depthVersion changes when the history gains a snapshot; it is what redraws this layer.
      if (showLiquidity && depthVersion >= 0) {
        const history = marketSession.manager.depthHistory;
        liquidity.update(history);
        const firstColumn = Math.max(0, Math.floor((plotL - colX(0)) / colW) - 1);
        liquidity.draw(ctx, history, { candles: allCandles, startIndex: firstColumn, colX, colW, plotR, priceY, rowH });
      }

      // ── Traded-volume heatmap (session volume by price) ──
      if (showHeatmap && volumeProfile && volumeProfile.levels.length) {
        const sorted = volumeProfile.levels.map((l) => l.totalVolume).sort((a, b) => a - b);
        const cap = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 1;
        for (const level of volumeProfile.levels) {
          const y = priceY(level.price);
          if (y + rowH < plotT || y > plotB) continue;
          const t = Math.min(1, level.totalVolume / cap);
          const [r, g, b] = heatColor(t);
          ctx.fillStyle = `rgba(${r},${g},${b},${0.08 + t * 0.32})`;
          ctx.fillRect(plotL, y, plotW, rowH);
        }
      }

      // ── Value area band ──
      if (ind.valueArea && volumeProfile && volumeProfile.levels.length > 2) {
        const yTop = priceY(volumeProfile.vah);
        const yBot = priceY(volumeProfile.val) + rowH;
        ctx.fillStyle = withAlpha(pocColor, 0.05);
        ctx.fillRect(plotL, yTop, plotW, yBot - yTop);
      }

      // ── Grid ──
      const gridEvery = rowH >= 12 ? 1 : Math.ceil(12 / rowH);
      ctx.strokeStyle = p.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = firstRow; r <= lastRow + 1; r++) {
        if (r % gridEvery) continue;
        const y = Math.round(plotT + r * rowH - view.scrollY) + 0.5;
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
      }
      ctx.stroke();

      // ── Candle columns ──
      const startIndex = Math.max(0, Math.floor((plotL - colX(0)) / colW) - 1);
      const showText = rowH >= 11 && colW >= 58;
      const fontSize = Math.max(9, Math.min(11, rowH * 0.6));
      ctx.font = monoFont(fontSize);
      ctx.textBaseline = "middle";

      for (let ci = startIndex; ci < allCandles.length; ci++) {
        const candle = allCandles[ci];
        const x = colX(ci);
        if (x > plotR) break;
        if (x + colW < plotL || candle.tradeCount === 0) continue;
        drawCandleColumn(ctx, candle, x, colW, rowH, priceY, plotT, plotB, mode, showText, showHeatmap || showLiquidity, p, ind, pocColor);

        // Stacked imbalances — vertical bars at the column edge.
        if (ind.stackedImbalances) {
          for (const stack of stackedRuns(candle, ind.imbalanceRatio, ind.stackedLevels)) {
            const yTop = priceY(stack.end);
            const yBot = priceY(stack.start) + rowH;
            ctx.fillStyle = stack.dir === "buy" ? p.buy : p.sell;
            ctx.beginPath();
            ctx.roundRect(x + colW - 4.5, yTop + 1, 3, yBot - yTop - 2, 1.5);
            ctx.fill();
          }
        }
      }

      // ── Session POC / VAH / VAL / high / low lines ──
      const sessionLines: [number, string, number][] = [];
      if (volumeProfile && volumeProfile.levels.length > 2) {
        if (ind.sessionPoc) sessionLines.push([volumeProfile.poc, pocColor, 0.85]);
        if (ind.valueArea) sessionLines.push([volumeProfile.vah, pocColor, 0.4], [volumeProfile.val, pocColor, 0.4]);
      }
      if (ind.sessionHighLow && session) {
        sessionLines.push([session.high, p.textSecondary, 0.45], [session.low, p.textSecondary, 0.45]);
      }
      // Prior sessions: long dashes for yesterday, fine dots for naked POCs.
      const priorLines: [number, string, number[]][] = [];
      if (ind.priorDay && prior.previous) {
        priorLines.push(
          [prior.previous.poc, withAlpha(pocColor, 0.6), [10, 5]],
          [prior.previous.vah, withAlpha(pocColor, 0.32), [10, 5]],
          [prior.previous.val, withAlpha(pocColor, 0.32), [10, 5]],
          [prior.previous.vwap, withAlpha(vwapColor, 0.5), [10, 5]]
        );
      }
      if (ind.nakedPocs) for (const day of prior.naked) priorLines.push([day.poc, withAlpha(pocColor, 0.5), [1.5, 3]]);
      for (const [price, color, dash] of priorLines) {
        const y = Math.round(priceY(price) + rowH / 2) + 0.5;
        if (y < plotT || y > plotB) continue;
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (sessionLines.length) {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        for (const [price, color, alpha] of sessionLines) {
          const y = Math.round(priceY(price) + rowH / 2) + 0.5;
          ctx.strokeStyle = withAlpha(color, alpha);
          ctx.beginPath();
          ctx.moveTo(plotL, y);
          ctx.lineTo(plotR, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // ── VWAP path and σ bands ──
      const vwapPath = (offset: number) => {
        ctx.beginPath();
        let started = false;
        for (let ci = startIndex; ci < allCandles.length; ci++) {
          const { vwap, vwapStd = 0 } = allCandles[ci];
          if (vwap === undefined) continue;
          const x = colX(ci) + colW / 2;
          if (x < plotL - colW) continue;
          const y = priceY(vwap + offset * vwapStd) + rowH / 2;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        return started;
      };
      if (ind.vwap && ind.vwapBands) {
        ctx.lineWidth = 1;
        for (const k of [2, 1, -1, -2]) {
          ctx.strokeStyle = withAlpha(vwapColor, Math.abs(k) === 1 ? 0.55 : 0.32);
          ctx.setLineDash(Math.abs(k) === 1 ? [4, 3] : [2, 4]);
          if (vwapPath(k)) ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (ind.vwap) {
        ctx.strokeStyle = vwapColor;
        ctx.lineWidth = 1.75;
        if (vwapPath(0)) ctx.stroke();
      }

      // ── Bubbles: big trades and liquidations ──
      // Placed at the print price and at its time within the candle, sized by
      // notional relative to the largest visible bubble of the same kind.
      // Big trades are plain discs; liquidations carry a warning-coloured ring.
      const bubbles: Bubble[] = [];
      const firstVisible = allCandles[startIndex]?.openTime ?? allCandles[0].openTime;
      const collect = <T extends { timestamp: number; quoteVolume: number }>(items: T[], keep: (item: T) => boolean) => {
        const visible: { item: T; ci: number }[] = [];
        let max = 0;
        for (let i = items.length - 1; i >= 0 && visible.length < MAX_BUBBLES; i--) {
          const item = items[i];
          if (item.timestamp < firstVisible - ARRIVAL_SLACK_MS) break;
          if (item.timestamp < firstVisible || !keep(item)) continue;
          const ci = candleIndexAt(allCandles, item.timestamp);
          if (ci < 0) continue;
          visible.push({ item, ci });
          if (item.quoteVolume > max) max = item.quoteVolume;
        }
        return { visible: visible.reverse(), max: max || 1 };
      };
      const place = (timestamp: number, price: number, ci: number) => {
        const candle = allCandles[ci];
        const frac = Math.min(1, Math.max(0, (timestamp - candle.openTime) / (candle.closeTime - candle.openTime + 1)));
        return { x: colX(ci) + 6 + frac * (colW - 12), y: priceY(price) + rowH / 2 };
      };
      const onScreen = (x: number, y: number) => x >= plotL - 16 && x <= plotR + 16 && y >= plotT - 16 && y <= plotB + 16;
      const label = (text: string, x: number, y: number) => {
        ctx.font = monoFont(8, 700);
        ctx.textAlign = "center";
        ctx.fillStyle = p.text;
        ctx.fillText(text, x, y + 0.5);
        ctx.font = monoFont(fontSize);
      };

      if (ind.bigTrades && bigTrades.length) {
        const { visible, max } = collect(bigTrades, (t) => t.ratio >= ind.bigTradeRatio);
        for (const { item: trade, ci } of visible) {
          const { x, y } = place(trade.timestamp, trade.price, ci);
          if (!onScreen(x, y)) continue;
          const r = 3 + 10 * Math.sqrt(trade.quoteVolume / max);
          const color = trade.side === "buy" ? p.buy : p.sell;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(color, 0.5);
          ctx.fill();
          if (r >= 11) label(formatCompact(trade.quoteVolume, 1), x, y);
          bubbles.push({ x, y, r, kind: "trade", trade });
        }
      }

      if (ind.liquidations && marketType === "perpetual" && liquidations.length) {
        const { visible, max } = collect(liquidations, () => true);
        for (const { item: liq, ci } of visible) {
          const { x, y } = place(liq.timestamp, liq.price, ci);
          if (!onScreen(x, y)) continue;
          const r = 3 + 11 * Math.sqrt(liq.quoteVolume / max);
          const color = liq.side === "long" ? p.sell : p.buy;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(color, r > 8 ? 0.42 : 0.3);
          ctx.fill();
          ctx.lineWidth = 1.75;
          ctx.strokeStyle = p.warn;
          ctx.stroke();
          if (r >= 11) label(formatCompact(liq.quoteVolume, 1), x, y);
          bubbles.push({ x, y, r, kind: "liquidation", liq });
        }
      }
      bubblesRef.current = bubbles;

      // ── Absorption and iceberg markers ──
      // Absorption: an outlined band across the candle at the level that held.
      // Iceberg: an ice-blue diamond at the refilling level and time.
      if ((ind.absorption || ind.icebergs) && microEvents.length) {
        const hits: MicroHit[] = [];
        for (let i = microEvents.length - 1; i >= 0 && hits.length < MAX_BUBBLES; i--) {
          const ev = microEvents[i];
          if (ev.time < firstVisible - ARRIVAL_SLACK_MS) break;
          if (ev.kind === "absorption" ? !ind.absorption : !ind.icebergs) continue;
          const ci = candleIndexAt(allCandles, ev.kind === "absorption" ? ev.start : ev.time);
          if (ci < 0) continue;
          const y = priceY(ev.price);
          if (y + rowH < plotT || y > plotB) continue;
          const color = ev.side === "bid" ? p.buy : p.sell;
          if (ev.kind === "absorption") {
            const x0 = colX(ci) + 2;
            const w = colW - 4;
            ctx.fillStyle = withAlpha(color, 0.1);
            ctx.strokeStyle = withAlpha(color, 0.9);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(x0, y + 0.5, w, rowH - 1, 3);
            ctx.fill();
            ctx.stroke();
            if (rowH >= 10) {
              ctx.font = monoFont(7.5, 700);
              const label = "ABS";
              const lw = ctx.measureText(label).width + 6;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.roundRect(x0 - 1, y + rowH / 2 - 5, lw, 10, 3);
              ctx.fill();
              ctx.fillStyle = p.light ? "#ffffff" : p.bgBase;
              ctx.textAlign = "left";
              ctx.fillText(label, x0 + 2, y + rowH / 2 + 0.5);
              ctx.font = monoFont(fontSize);
            }
            hits.push({ x: x0, y, w, h: rowH, event: ev });
          } else {
            const { x } = place(ev.time, ev.price, ci);
            const cy = y + rowH / 2;
            const r = Math.max(4, Math.min(7, rowH * 0.38));
            ctx.beginPath();
            ctx.moveTo(x, cy - r);
            ctx.lineTo(x + r, cy);
            ctx.lineTo(x, cy + r);
            ctx.lineTo(x - r, cy);
            ctx.closePath();
            ctx.fillStyle = withAlpha(ICE, 0.85);
            ctx.fill();
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = color;
            ctx.stroke();
            hits.push({ x: x - r, y: cy - r, w: r * 2, h: r * 2, event: ev });
          }
        }
        microRef.current = hits;
      }

      // ── Last price line ──
      const lastY = priceY(lastPrice) + rowH / 2;
      const up = lastPrice >= (allCandles[allCandles.length - 1].open || lastPrice);
      if (ind.lastPrice) {
        ctx.strokeStyle = withAlpha(up ? p.buy : p.sell, 0.8);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(plotL, Math.round(lastY) + 0.5);
        ctx.lineTo(plotR, Math.round(lastY) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── Crosshair lines ──
      const mouse = mouseRef.current;
      const inPlot = mouse && mouse.x >= plotL && mouse.x <= plotR && mouse.y >= plotT && mouse.y <= plotB && !dragRef.current;
      if (inPlot && mouse) {
        ctx.strokeStyle = withAlpha(p.textSecondary, 0.45);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plotL, Math.round(mouse.y) + 0.5);
        ctx.lineTo(plotR, Math.round(mouse.y) + 0.5);
        ctx.moveTo(Math.round(mouse.x) + 0.5, plotT);
        ctx.lineTo(Math.round(mouse.x) + 0.5, plotB);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      // ── Time header ──
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(plotL, 0, plotW, HEADER_H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotL, 0, plotW, H);
      ctx.clip();
      ctx.font = monoFont(10, 500);
      ctx.textAlign = "center";
      for (let ci = startIndex; ci < allCandles.length; ci++) {
        const candle = allCandles[ci];
        const x = colX(ci);
        if (x > plotR) break;
        if (x + colW < plotL) continue;
        const live = !candle.complete && ci === allCandles.length - 1;
        if (live) {
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.roundRect(x + colW / 2 - 26, 3, 52, HEADER_H - 6, 7);
          ctx.fill();
        }
        ctx.fillStyle = live ? p.onAccent : p.textMuted;
        ctx.font = monoFont(10, live ? 700 : 500);
        ctx.fillText(formatHM(candle.openTime), x + colW / 2, HEADER_H / 2 + 1);
        if (ind.summaryRows) drawSummary(ctx, candle, x, colW, plotB, p);
      }
      ctx.restore();

      // ── Summary labels (axis column) ──
      if (ind.summaryRows) {
        ctx.fillStyle = p.bgPanel;
        ctx.fillRect(plotR, plotB, AXIS_W, summaryH);
        ctx.fillStyle = p.borderMuted;
        ctx.fillRect(plotL, plotB, plotW + AXIS_W, 1);
        ctx.font = monoFont(9, 600);
        ctx.textAlign = "left";
        SUMMARY_ROWS.forEach((label, i) => {
          ctx.fillStyle = p.textMuted;
          ctx.fillText(label.toUpperCase(), plotR + 8, plotB + i * SUMMARY_ROW_H + SUMMARY_ROW_H / 2 + 1);
        });
      }

      // ── Attached session profile ──
      if (showProfile) drawProfile(ctx, volumeProfile, profileW, plotT, plotB, summaryH, rowH, priceY, p, pocColor);

      // ── Price axis ──
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(plotR, 0, AXIS_W, plotB);
      const labelEvery = Math.max(1, Math.ceil(16 / rowH));
      ctx.font = monoFont(10);
      ctx.textAlign = "right";
      ctx.fillStyle = p.textMuted;
      for (let r = firstRow; r <= lastRow; r++) {
        const price = maxPrice - r * tick;
        const index = Math.round(price / tick);
        if (index % labelEvery) continue;
        const y = plotT + r * rowH - view.scrollY + rowH / 2;
        if (y < plotT + 6 || y > plotB - 6) continue;
        ctx.fillText(formatPriceValue(price, decimals), W - 8, y + 1);
      }

      const tag = (price: number, color: string, label?: string, textColor = p.light ? "#ffffff" : p.bgBase) => {
        const y = Math.round(priceY(price) + rowH / 2);
        if (y < plotT || y > plotB) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(plotR + 4, y - 9, AXIS_W - 8, 18, 9);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.font = monoFont(10, 700);
        ctx.textAlign = "center";
        ctx.fillText(formatPriceValue(price, decimals), plotR + AXIS_W / 2, y + 1);
        if (label) {
          // Small label pill just inside the plot, left of the axis.
          ctx.font = monoFont(8, 700);
          const w = ctx.measureText(label).width + 10;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(plotR - w - 2, y - 7, w, 14, 7);
          ctx.fill();
          ctx.fillStyle = textColor;
          ctx.fillText(label, plotR - w / 2 - 2, y + 1);
        }
      };
      // Prior-session levels: tagged on the axis when in view, otherwise pinned
      // to the top or bottom edge with an arrow so they're never silently hidden.
      const priorTags: [number, string, string][] = [];
      if (ind.nakedPocs) for (const day of prior.naked) priorTags.push([day.poc, withAlpha(pocColor, 0.45), `nPOC ${shortDay(day.day)}`]);
      if (ind.priorDay && prior.previous) {
        priorTags.push(
          [prior.previous.vah, withAlpha(pocColor, 0.4), "pVAH"],
          [prior.previous.val, withAlpha(pocColor, 0.4), "pVAL"],
          [prior.previous.vwap, withAlpha(vwapColor, 0.55), "pVWAP"],
          [prior.previous.poc, withAlpha(pocColor, 0.65), "pPOC"]
        );
      }
      const above: [number, string, string][] = [];
      const below: [number, string, string][] = [];
      for (const item of priorTags) {
        const y = Math.round(priceY(item[0]) + rowH / 2);
        if (y < plotT) above.push(item);
        else if (y > plotB) below.push(item);
        else tag(...item);
      }
      const edge = (items: [number, string, string][], top: boolean) => {
        // Nearest level closest to the plot.
        items.sort((a, b) => (top ? a[0] - b[0] : b[0] - a[0]));
        ctx.font = monoFont(9, 700);
        ctx.textAlign = "center";
        items.slice(0, 5).forEach(([price, color, label], i) => {
          const text = `${top ? "▲" : "▼"} ${label} ${formatPriceValue(price, decimals)}`;
          const w = ctx.measureText(text).width + 12;
          const y = top ? plotT + 6 + i * 17 : plotB - 20 - i * 17;
          ctx.fillStyle = withAlpha(p.bgPanel, 0.85);
          ctx.beginPath();
          ctx.roundRect(plotR - w - 4, y, w, 15, 7.5);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = p.textSecondary;
          ctx.fillText(text, plotR - w / 2 - 4, y + 8);
        });
      };
      edge(above, true);
      edge(below, false);
      if (ind.sessionPoc && volumeProfile && volumeProfile.levels.length > 2) tag(volumeProfile.poc, withAlpha(pocColor, 0.9), "POC");
      if (ind.vwap && session) tag(session.vwap, withAlpha(vwapColor, 0.9), "VWAP");
      tag(lastPrice, up ? p.buy : p.sell);

      if (inPlot && mouse) {
        const price = yPrice(mouse.y);
        ctx.fillStyle = p.text;
        ctx.beginPath();
        ctx.roundRect(plotR + 4, mouse.y - 9, AXIS_W - 8, 18, 9);
        ctx.fill();
        ctx.fillStyle = p.bgBase;
        ctx.font = monoFont(10, 700);
        ctx.textAlign = "center";
        ctx.fillText(formatPriceValue(price, decimals), plotR + AXIS_W / 2, mouse.y + 1);
      }

      // ── Corner (axis header) ──
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(plotR, 0, AXIS_W, HEADER_H);
      ctx.fillStyle = p.textMuted;
      ctx.font = monoFont(9, 600);
      ctx.textAlign = "center";
      ctx.fillText(`TICK ${formatPriceValue(tick, priceDecimals(tick))}`, plotR + AXIS_W / 2, HEADER_H / 2 + 1);
    },
    [allCandles, tickSize, volumeProfile, session, ticker, mode, showProfile, showHeatmap, ind, decimals, liquidations, bigTrades, marketType, microEvents, showLiquidity, depthVersion, liquidity, marketSession, prior]
  );

  const { containerRef, canvasRef, redraw } = useCanvas(draw);

  // Wheel: scroll / zoom. Attached natively so preventDefault works.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        view.rowH = Math.min(40, Math.max(4, view.rowH * (e.deltaY > 0 ? 0.9 : 1.1)));
      } else if (e.altKey) {
        view.colW = Math.min(240, Math.max(36, view.colW * (e.deltaY > 0 ? 0.9 : 1.1)));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        view.scrollX += e.shiftKey ? e.deltaY : -e.deltaX;
        view.followX = view.scrollX <= 0;
      } else {
        view.scrollY += e.deltaY;
        view.followY = false;
      }
      redraw();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, redraw]);

  const resetView = useCallback(() => {
    viewRef.current = { ...viewRef.current, followX: true, followY: true, scrollX: 0 };
    redraw();
  }, [redraw]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y };
    const drag = dragRef.current;
    if (drag) {
      const view = viewRef.current;
      view.scrollX = drag.scrollX + (x - drag.x);
      view.scrollY = drag.scrollY - (y - drag.y);
      view.followX = view.scrollX <= 0;
      view.followY = false;
      hideTooltip();
      redraw();
      return;
    }
    redraw();
    const layout = layoutRef.current;
    if (!layout) return hideTooltip();
    const { plotL, plotR, plotT, plotB, colX } = layout;
    const colW = viewRef.current.colW;
    const first = colX(0);
    const index = Math.floor((x - first) / colW);
    const candle = allCandles[index];
    if (!candle || x < plotL || x > plotR) {
      hideTooltip();
      return;
    }
    if (y > plotB) {
      setCrosshair(candle.openTime, null);
      const venues = Object.entries(candle.venueVolumes)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([v, vol]) => `${VENUE_LABEL[v] ?? v}: ${formatCompact(vol ?? 0)} (${(((vol ?? 0) / candle.volume) * 100).toFixed(0)}%)`);
      showTooltip(
        `Candle ${formatHM(candle.openTime)}`,
        [
          `Open: ${formatPriceValue(candle.open, decimals)}`,
          `High: ${formatPriceValue(candle.high, decimals)}`,
          `Low: ${formatPriceValue(candle.low, decimals)}`,
          `Close: ${formatPriceValue(candle.close, decimals)}`,
          `Volume: ${formatCompact(candle.volume, 2)}`,
          `Delta: ${formatSigned(candle.delta, 2)} (${candle.volume ? ((candle.delta / candle.volume) * 100).toFixed(1) : "0"}%)`,
          `CVD: ${formatSigned(candle.cumulativeDelta, 2)}`,
          `Trades: ${candle.tradeCount.toLocaleString()}`,
          ...(venues.length > 1 ? ["", ...venues] : []),
        ].join("\n"),
        e
      );
      return;
    }
    if (y < plotT) return hideTooltip();
    // Microstructure markers first: they mark the reason a level matters.
    const micro = microRef.current.find((m) => x >= m.x - 2 && x <= m.x + m.w + 2 && y >= m.y - 2 && y <= m.y + m.h + 2);
    if (micro) {
      const ev = micro.event;
      setCrosshair(candle.openTime, ev.price);
      const held = ev.side === "bid" ? "Bid held" : "Offer held";
      showTooltip(
        ev.kind === "absorption" ? `Absorption · ${held}` : `Iceberg · ${held}`,
        [
          `Price: ${formatPriceValue(ev.price, decimals)}`,
          ev.kind === "absorption"
            ? `Aggressive ${ev.side === "bid" ? "selling" : "buying"} at the level: ${formatCompact(ev.volume, 3)} ($${formatCompact(ev.notional, 1)}), ${ev.ratio.toFixed(1)}× an average 10 s window`
            : `Traded into the level: ${formatCompact(ev.volume, 3)} ($${formatCompact(ev.notional, 1)}), ${ev.ratio.toFixed(1)}× its displayed size`,
          `Window: ${formatClock(ev.start)} – ${formatClock(ev.time)}`,
          ...(ev.venue ? [`Venue: ${VENUE_LABEL[ev.venue] ?? ev.venue}`] : []),
          "",
          ev.kind === "absorption"
            ? "Heavy aggressive volume met resting orders here and price did not trade through. Heuristic: a sign of passive interest, not a guarantee."
            : "More traded against this level than it displayed, and it kept refilling: likely hidden or replenishing size. Heuristic.",
        ].join("\n"),
        e
      );
      return;
    }
    // Bubbles take precedence over the cell underneath; the smallest hit wins.
    let hit: Bubble | null = null;
    for (const bubble of bubblesRef.current) {
      const d = Math.hypot(bubble.x - x, bubble.y - y);
      if (d <= bubble.r + 2 && (!hit || bubble.r < hit.r)) hit = bubble;
    }
    if (hit?.kind === "trade") {
      const { trade } = hit;
      setCrosshair(candle.openTime, trade.price);
      showTooltip(
        `Big ${trade.side} · $${formatCompact(trade.quoteVolume, 2)}`,
        [
          `Price: ${formatPriceValue(trade.price, decimals)}`,
          `Size: ${formatCompact(trade.quantity, 3)} (${trade.ratio.toFixed(1)}× average print)`,
          `Time: ${formatClock(trade.timestamp, true)}`,
          `Venue: ${VENUE_LABEL[trade.venue] ?? trade.venue}`,
          "",
          trade.side === "buy" ? "An aggressive buyer lifted the offer." : "An aggressive seller hit the bid.",
        ].join("\n"),
        e
      );
      return;
    }
    if (hit) {
      const { liq } = hit;
      setCrosshair(candle.openTime, liq.price);
      showTooltip(
        `${liq.side === "long" ? "Long" : "Short"} liquidation · $${formatCompact(liq.quoteVolume, 2)}`,
        [
          `Price: ${formatPriceValue(liq.price, decimals)}`,
          `Size: ${formatCompact(liq.quantity, 3)}`,
          `Time: ${formatClock(liq.timestamp, true)}`,
          `Venue: ${VENUE_LABEL[liq.venue] ?? liq.venue}`,
          "",
          liq.side === "long"
            ? "A long position was force-closed with a market sell."
            : "A short position was force-closed with a market buy.",
        ].join("\n"),
        e
      );
      return;
    }
    const price = layout.yPrice(y);
    setCrosshair(candle.openTime, price);
    const level = findLevel(candle, price, layout.tick);
    if (!level) return hideTooltip();
    const share = candle.volume ? (level.totalVolume / candle.volume) * 100 : 0;
    showTooltip(
      `${formatPriceValue(price, decimals)} · ${formatHM(candle.openTime)}`,
      [
        `Sell (bid): ${formatCompact(level.bidVolume, 3)}`,
        `Buy (ask): ${formatCompact(level.askVolume, 3)}`,
        `Total: ${formatCompact(level.totalVolume, 3)} (${share.toFixed(1)}% of candle)`,
        `Delta: ${formatSigned(level.delta, 3)}`,
        `Trades: ${level.buyTrades} buy / ${level.sellTrades} sell`,
        `Largest print: ${formatCompact(level.maxTradeSize, 3)}`,
        ...(showLiquidity
          ? (() => {
              const resting = LiquidityHeatmapRenderer.sizeAt(marketSession.manager.depthHistory, Math.min(candle.closeTime, Date.now()), price);
              return resting === null ? [] : [`Resting (book, latest in candle): ${formatCompact(resting, 3)}`];
            })()
          : []),
        `Imbalance: ${(() => { const dir = imbalanceOf(level, ind.imbalanceRatio); return dir ? `${dir} ≥ ${ind.imbalanceRatio}×` : "none"; })()}`,
      ].join("\n"),
      e
    );
  };

  const handleMouseLeave = () => {
    mouseRef.current = null;
    dragRef.current = null;
    hideTooltip();
    setCrosshair(null, null);
    redraw();
  };

  const tf = timeframe.toUpperCase();
  const venueLabel = marketType === "forex" ? "FX" : VENUE_LABEL[venue] ?? venue;

  return (
    <Panel
      title="Footprint" icon={<Icon.Footprint />}
      subtitle={`${symbol} · ${tf} · ${venueLabel}`}
      className="footprint-panel"
      actions={
        <>
          <Segmented size="xs" value={mode} options={MODES} onChange={setMode} ariaLabel="Footprint cell mode" />
          <span className="actions-divider" />
          <IndicatorsMenu />
          <Button
            className={`chip ${showProfile ? "is-active" : ""}`}
            onClick={() => setPanelVisible("volumeProfile", !showProfile)}
            title="Session volume profile attached to the price ladder"
          >
            Profile
          </Button>
          <Button
            className={`chip ${showHeatmap ? "is-active" : ""}`}
            onClick={() => setHeatmapVisible("tradedVolume", !showHeatmap)}
            title="Traded-volume heatmap by price (executed volume, not resting liquidity)"
          >
            Heatmap
          </Button>
          <Button
            className={`chip ${showLiquidity ? "is-active" : ""}`}
            onClick={() => setHeatmapVisible("restingLiquidity", !showLiquidity)}
            title="Resting-liquidity heatmap: order-book depth over time, summed across the selected venues"
          >
            Liquidity
          </Button>
          <Button className="chip" onClick={resetView} title="Follow the live candle and last price (double-click chart)">
            ⟲ Live
          </Button>
        </>
      }
      footer={
        <div className="footprint-legend">
          {ind.vwap && <span><i className="lg" style={{ background: ind.vwapColor ?? "var(--vwap)" }} />VWAP{ind.vwapBands ? " ±1σ ±2σ" : ""}</span>}
          {(ind.sessionPoc || ind.valueArea) && <span><i className="lg" style={{ background: ind.pocColor ?? "var(--poc)" }} />POC / VA {Math.round(ind.valueAreaPct * 100)}%</span>}
          {ind.stackedImbalances && <span><i className="lg lg-stack-buy" /><i className="lg lg-stack-sell" />Stacked ≥{ind.stackedLevels} @ {ind.imbalanceRatio}×</span>}
          {showLiquidity && <span><i className="lg lg-depth" />Resting liquidity</span>}
          {(ind.absorption || ind.icebergs) && (
            <span>{ind.absorption && <><i className="lg lg-abs" />Absorption </>}{ind.icebergs && <><i className="lg lg-ice" />Iceberg</>}</span>
          )}
          {(ind.priorDay && prior.previous) || (ind.nakedPocs && prior.naked.length) ? <span><i className="lg lg-prior" />Prior day · naked POC</span> : null}
          {ind.bigTrades && (
            <span><i className="lg" style={{ background: "var(--buy)" }} /><i className="lg" style={{ background: "var(--sell)" }} />Big prints ≥{ind.bigTradeRatio}×</span>
          )}
          {ind.liquidations && marketType === "perpetual" && (
            <span><i className="lg lg-liq" style={{ background: "var(--sell)" }} /><i className="lg lg-liq" style={{ background: "var(--buy)" }} />Liquidations long / short</span>
          )}
          <span className="legend-hint">Drag to pan · Wheel scroll · ⌘/Ctrl+wheel row zoom · Alt+wheel column width · Double-click to follow</span>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="canvas-host"
        onMouseDown={(e) => {
          const rect = containerRef.current!.getBoundingClientRect();
          dragRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            scrollX: viewRef.current.scrollX,
            scrollY: viewRef.current.scrollY,
          };
        }}
        onMouseUp={() => { dragRef.current = null; }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={resetView}
      >
        <canvas ref={canvasRef} />
        {allCandles.length === 0 && (
          <div className="canvas-overlay">
            <div className="spinner" />
            <strong>Waiting for trades</strong>
            <span>Building the footprint from the live stream…</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Rounded cell used for footprint, profile and summary blocks. */
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w <= 0 || h <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(3, h / 2, w / 2));
  ctx.fill();
}

function findLevel(candle: FootprintCandle, price: number, tick: number) {
  for (const [p, level] of candle.levels) {
    if (Math.abs(p - price) < tick / 2) return level;
  }
  return undefined;
}

function drawCandleColumn(
  ctx: CanvasRenderingContext2D,
  candle: FootprintCandle,
  x: number,
  colW: number,
  rowH: number,
  priceY: (price: number) => number,
  plotT: number,
  plotB: number,
  mode: FootprintMode,
  showText: boolean,
  heatmapOn: boolean,
  p: Palette,
  ind: IndicatorSettings,
  pocColor: string
) {
  const cellX = x + STRIP_W + 3;
  const cellW = colW - STRIP_W - 8;
  let maxAbsDelta = 0;
  for (const level of candle.levels.values()) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(level.delta));
  const maxVol = candle.maxVolumeAtLevel || 1;
  const bgScale = heatmapOn ? 0.55 : 1;

  for (const level of candle.levels.values()) {
    const y = priceY(level.price);
    if (y + rowH < plotT || y > plotB) continue;
    const h = Math.max(1, rowH - (rowH >= 8 ? 2 : 1));
    const intensity = level.totalVolume / maxVol;

    if (mode === "bidask") {
      // Split cell: sell side (left) and buy side (right), each shaded by its own share.
      const half = cellW / 2;
      ctx.fillStyle = withAlpha(p.sell, (0.07 + 0.55 * (level.bidVolume / maxVol)) * bgScale);
      cell(ctx, cellX, y, half - 1, h);
      ctx.fillStyle = withAlpha(p.buy, (0.07 + 0.55 * (level.askVolume / maxVol)) * bgScale);
      cell(ctx, cellX + half + 1, y, half - 1, h);
    } else if (mode === "delta") {
      const t = maxAbsDelta ? Math.abs(level.delta) / maxAbsDelta : 0;
      ctx.fillStyle = withAlpha(level.delta >= 0 ? p.buy : p.sell, (0.07 + 0.6 * t) * bgScale);
      cell(ctx, cellX, y, cellW, h);
    } else {
      ctx.fillStyle = withAlpha(p.accent, (0.05 + 0.55 * intensity) * bgScale);
      cell(ctx, cellX, y, cellW, h);
    }

    const imb = ind.imbalances ? imbalanceOf(level, ind.imbalanceRatio) : null;
    if (showText) {
      const ty = y + rowH / 2 + 0.5;
      if (mode === "bidask") {
        const mid = cellX + cellW / 2;
        ctx.textAlign = "right";
        ctx.fillStyle = imb === "sell" ? p.sell : p.textSecondary;
        ctx.font = monoFont(Math.max(9, Math.min(11, rowH * 0.6)), imb === "sell" ? 700 : 400);
        ctx.fillText(formatCompact(level.bidVolume), mid - 4, ty);
        ctx.textAlign = "left";
        ctx.fillStyle = imb === "buy" ? p.buy : p.textSecondary;
        ctx.font = monoFont(Math.max(9, Math.min(11, rowH * 0.6)), imb === "buy" ? 700 : 400);
        ctx.fillText(formatCompact(level.askVolume), mid + 4, ty);
      } else {
        const value = mode === "delta" ? level.delta : level.totalVolume;
        ctx.textAlign = "center";
        ctx.fillStyle = intensity > 0.7 ? p.text : p.textSecondary;
        ctx.font = monoFont(Math.max(9, Math.min(11, rowH * 0.6)), intensity > 0.7 ? 600 : 400);
        ctx.fillText(mode === "delta" ? formatSigned(value) : formatCompact(value), cellX + cellW / 2, ty);
      }
    }

    if (ind.candlePoc && level.totalVolume === candle.maxVolumeAtLevel && level.totalVolume > 0) {
      ctx.strokeStyle = pocColor;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.roundRect(cellX + 0.5, y + 0.5, cellW - 1, h - 1, Math.min(3, h / 2));
      ctx.stroke();
    }
  }

  // OHLC strip
  if (ind.ohlcStrip && Number.isFinite(candle.high) && Number.isFinite(candle.low)) {
    const color = candle.close >= candle.open ? p.buy : p.sell;
    const cx = x + 2 + STRIP_W / 2;
    const yHigh = priceY(candle.high);
    const yLow = priceY(candle.low) + rowH;
    ctx.fillStyle = withAlpha(color, 0.55);
    ctx.fillRect(cx - 0.5, yHigh, 1, yLow - yHigh);
    const yOpen = priceY(candle.open) + rowH / 2;
    const yClose = priceY(candle.close) + rowH / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 2, Math.min(yOpen, yClose) - 1, STRIP_W, Math.max(3, Math.abs(yClose - yOpen) + 2), 2);
    ctx.fill();
  }
}

function drawSummary(ctx: CanvasRenderingContext2D, candle: FootprintCandle, x: number, colW: number, top: number, p: Palette) {
  const pad = 6;
  const deltaPct = candle.volume ? candle.delta / candle.volume : 0;
  const rows: { text: string; color: string; bg?: string }[] = [
    { text: formatCompact(candle.volume), color: p.textSecondary },
    {
      text: formatSigned(candle.delta),
      color: candle.delta >= 0 ? p.buy : p.sell,
      bg: withAlpha(candle.delta >= 0 ? p.buy : p.sell, 0.08 + Math.min(0.35, Math.abs(deltaPct))),
    },
    { text: formatSigned(candle.cumulativeDelta), color: candle.cumulativeDelta >= 0 ? p.buy : p.sell },
    { text: candle.tradeCount.toLocaleString(), color: p.textMuted },
  ];
  ctx.font = monoFont(10, 500);
  ctx.textAlign = "right";
  rows.forEach((row, i) => {
    const y = top + 1 + i * SUMMARY_ROW_H;
    if (row.bg) {
      ctx.fillStyle = row.bg;
      cell(ctx, x + 3, y + 1, colW - 6, SUMMARY_ROW_H - 2);
    }
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, x + colW - pad, y + SUMMARY_ROW_H / 2);
  });
}

function drawProfile(
  ctx: CanvasRenderingContext2D,
  profile: VolumeProfile | null,
  width: number,
  plotT: number,
  plotB: number,
  summaryH: number,
  rowH: number,
  priceY: (price: number) => number,
  p: Palette,
  pocColor: string
) {
  ctx.fillStyle = p.bgPanel;
  ctx.fillRect(0, 0, width, plotB + summaryH);
  ctx.fillStyle = p.borderMuted;
  ctx.fillRect(width - 1, HEADER_H, 1, plotB - HEADER_H);
  ctx.font = monoFont(9, 600);
  ctx.textAlign = "left";
  ctx.fillStyle = p.textMuted;
  ctx.fillText("SESSION VP", 8, HEADER_H / 2 + 1);
  if (!profile || !profile.levels.length) return;

  const max = Math.max(...profile.levels.map((l) => l.totalVolume)) || 1;
  const barMax = width - 10;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, plotT, width, plotB - plotT);
  ctx.clip();
  for (const level of profile.levels) {
    const y = priceY(level.price);
    if (y + rowH < plotT || y > plotB) continue;
    const inValue = level.price <= profile.vah && level.price >= profile.val;
    const alpha = inValue ? 0.75 : 0.35;
    const h = Math.max(1, rowH - (rowH > 6 ? 1 : 0));
    const sellW = (level.bidVolume / max) * barMax;
    const buyW = (level.askVolume / max) * barMax;
    if (level.isPOC) {
      ctx.fillStyle = pocColor;
      cell(ctx, 6, y, sellW + buyW, h);
    } else {
      ctx.fillStyle = withAlpha(p.sell, alpha);
      cell(ctx, 6, y, sellW, h);
      ctx.fillStyle = withAlpha(p.buy, alpha);
      cell(ctx, 6 + sellW + 1, y, buyW, h);
    }
  }
  ctx.restore();

  // Summary under the profile
  if (summaryH < 40) return;
  const total = profile.totalVolume || 1;
  const buyShare = profile.buyVolume / total;
  const y = plotB + 4;
  ctx.font = monoFont(9, 600);
  ctx.fillStyle = p.textMuted;
  ctx.fillText("BUY / SELL", 8, y + 6);
  ctx.fillStyle = withAlpha(p.buy, 0.9);
  cell(ctx, 8, y + 14, Math.max(0, (width - 16) * buyShare - 1), 5);
  ctx.fillStyle = withAlpha(p.sell, 0.9);
  cell(ctx, 8 + (width - 16) * buyShare + 1, y + 14, Math.max(0, (width - 16) * (1 - buyShare) - 1), 5);
  ctx.font = monoFont(10, 600);
  ctx.fillStyle = p.buy;
  ctx.fillText(`${(buyShare * 100).toFixed(0)}%`, 8, y + 32);
  ctx.textAlign = "right";
  ctx.fillStyle = p.sell;
  ctx.fillText(`${((1 - buyShare) * 100).toFixed(0)}%`, width - 8, y + 32);
  ctx.textAlign = "left";
  ctx.fillStyle = p.textSecondary;
  ctx.fillText(formatCompact(profile.totalVolume), 8, y + 48);
}
