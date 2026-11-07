"use client";

import React, { useCallback, useRef } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import { STUDY_AXIS_W, STUDY_TIME_H, drawEmpty, drawValueAxis, niceStep } from "@/lib/chartUtils";
import { formatCompact, formatPriceValue, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";
import type { OrderBookLevel } from "@/lib/types/market";

// ─── Depth of Market ─────────────────────────────────────────────
// Cumulative resting liquidity on each side of the mid, with depth
// read-outs at fixed distances from the mid price.

const MAX_LEVELS = 100;

function cumulative(levels: OrderBookLevel[]) {
  let cum = 0;
  return levels.slice(0, MAX_LEVELS).map((l) => ({ price: l.price, cum: (cum += l.size) }));
}

function depthWithin(levels: OrderBookLevel[], mid: number, bps: number) {
  const limit = (mid * bps) / 10_000;
  return levels.reduce((sum, l) => (Math.abs(l.price - mid) <= limit ? sum + l.size : sum), 0);
}

export default function DepthOfMarket() {
  const orderBook = useSessionStore((s) => s.orderBook);
  const aggregatedBook = useSessionStore((s) => s.aggregatedBook);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const crosshairPrice = useSessionStore((s) => s.crosshairPrice);
  const tickSize = useSessionStore((s) => s.tickSize);
  const book = selectedVenues.length > 1 ? aggregatedBook ?? orderBook : orderBook ?? aggregatedBook;
  const geometryRef = useRef<{ min: number; max: number; plotR: number } | null>(null);

  const bestBid = book?.bids[0]?.price ?? 0;
  const bestAsk = book?.asks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;
  const decimals = priceDecimals(tickSize, mid);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 8;
      const plotB = H - STUDY_TIME_H;
      geometryRef.current = null;
      if (!book || !book.bids.length || !book.asks.length || !mid) {
        drawEmpty(ctx, W, H, "Waiting for order book…", p);
        return;
      }
      const bids = cumulative(book.bids);
      const asks = cumulative(book.asks);
      // Symmetric window around mid so both sides share a scale.
      const reach = Math.min(mid - bids[bids.length - 1].price, asks[asks.length - 1].price - mid);
      const min = mid - reach;
      const max = mid + reach;
      if (reach <= 0) return;
      const xOf = (price: number) => ((price - min) / (max - min)) * plotR;
      const visibleBids = bids.filter((b) => b.price >= min);
      const visibleAsks = asks.filter((a) => a.price <= max);
      const maxCum = Math.max(visibleBids.at(-1)?.cum ?? 0, visibleAsks.at(-1)?.cum ?? 0) * 1.1 || 1;
      const yOf = (v: number) => plotT + ((maxCum - v) / maxCum) * (plotB - plotT);
      drawValueAxis(ctx, 0, maxCum, yOf, plotR, plotT, plotB, W, p, (v) => formatCompact(v));

      const side = (points: { price: number; cum: number }[], color: string) => {
        ctx.beginPath();
        ctx.moveTo(xOf(mid), plotB);
        let prevY = plotB;
        for (const pt of points) {
          const x = xOf(pt.price);
          ctx.lineTo(x, prevY);
          prevY = yOf(pt.cum);
          ctx.lineTo(x, prevY);
        }
        const endX = color === p.buy ? 0 : plotR;
        ctx.lineTo(endX, prevY);
        ctx.lineTo(endX, plotB);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, plotT, 0, plotB);
        grad.addColorStop(0, withAlpha(color, 0.35));
        grad.addColorStop(1, withAlpha(color, 0.05));
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };
      side(visibleBids, p.buy);
      side(visibleAsks, p.sell);

      ctx.strokeStyle = withAlpha(p.text, 0.5);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(xOf(mid)) + 0.5, plotT);
      ctx.lineTo(Math.round(xOf(mid)) + 0.5, plotB);
      ctx.stroke();
      ctx.setLineDash([]);

      if (crosshairPrice !== null && crosshairPrice >= min && crosshairPrice <= max) {
        ctx.strokeStyle = withAlpha(p.accent, 0.7);
        ctx.beginPath();
        ctx.moveTo(Math.round(xOf(crosshairPrice)) + 0.5, plotT);
        ctx.lineTo(Math.round(xOf(crosshairPrice)) + 0.5, plotB);
        ctx.stroke();
      }

      // Price axis
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, plotB, W, STUDY_TIME_H);
      ctx.fillStyle = p.borderMuted;
      ctx.fillRect(0, plotB, W, 1);
      ctx.font = monoFont(9);
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const step = niceStep(max - min, Math.max(2, Math.floor(plotR / 90)));
      for (let price = Math.ceil(min / step) * step; price <= max; price += step) {
        const x = xOf(price);
        if (x < 30 || x > plotR - 30) continue;
        ctx.fillText(formatPriceValue(price, decimals), x, plotB + STUDY_TIME_H / 2 + 1);
      }
      geometryRef.current = { min, max, plotR };
    },
    [book, mid, crosshairPrice, decimals]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const geometry = geometryRef.current;
    if (!geometry || !book) return hideTooltip();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > geometry.plotR) return hideTooltip();
    const price = geometry.min + (x / geometry.plotR) * (geometry.max - geometry.min);
    const isBid = price < mid;
    const levels = isBid ? book.bids : book.asks;
    const size = levels.reduce((s, l) => ((isBid ? l.price >= price : l.price <= price) ? s + l.size : s), 0);
    const distance = ((price - mid) / mid) * 10_000;
    showTooltip(
      `${isBid ? "Bid" : "Ask"} depth to ${formatPriceValue(price, decimals)}`,
      [
        `Distance from mid: ${distance.toFixed(1)} bp`,
        `Cumulative ${isBid ? "bids" : "asks"}: ${formatCompact(size, 3)}`,
        "",
        `What this means: Size that must trade to push price ${isBid ? "down" : "up"} to this level.`,
      ].join("\n"),
      e
    );
  };

  const d10b = book && mid ? depthWithin(book.bids, mid, 10) : 0;
  const d10a = book && mid ? depthWithin(book.asks, mid, 10) : 0;
  const d25b = book && mid ? depthWithin(book.bids, mid, 25) : 0;
  const d25a = book && mid ? depthWithin(book.asks, mid, 25) : 0;
  const ratio = (b: number, a: number) => (a > 0 ? `${(b / a).toFixed(2)}×` : "—");
  const source = book && "venue" in book ? VENUE_LABEL[book.venue] ?? book.venue : "Consolidated";

  return (
    <Panel
      title="Market Depth" icon={<Icon.Depth />}
      subtitle={source}
      footer={
        <div className="study-stats">
          <Stat label="±10 bp bid" value={formatCompact(d10b)} tone="buy" />
          <Stat label="±10 bp ask" value={formatCompact(d10a)} tone="sell" />
          <Stat label="Bid/Ask 10bp" value={ratio(d10b, d10a)} />
          <Stat label="Bid/Ask 25bp" value={ratio(d25b, d25a)} />
        </div>
      }
    >
      <div ref={containerRef} className="canvas-host" onMouseMove={handleMove} onMouseLeave={hideTooltip}>
        <canvas ref={canvasRef} />
      </div>
    </Panel>
  );
}
