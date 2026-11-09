"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { resampleBars } from "@/lib/engine/analytics";
import {
  LIQUIDATION_FEED_VENUES,
  bucketLiquidations,
  isLiquidationCascade,
  summarizeLiquidations,
  type LiquidationBucket,
} from "@/lib/engine/derivatives";
import { useCanvas, withAlpha, monoFont, type Palette } from "@/hooks/useCanvas";
import { useMarketNow } from "@/hooks/useMarketNow";
import { STUDY_AXIS_W, STUDY_TIME_H, drawEmpty, drawTimeAxis, drawValueAxis } from "@/lib/chartUtils";
import { formatClock, formatCompact, formatPriceValue, priceDecimals, VENUE_LABEL } from "@/lib/format";
import { Icon } from "@/components/ui/Icons";
import { Panel, Segmented, Stat } from "@/components/ui/Primitives";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Liquidations ────────────────────────────────────────────────
// Forced closes per time bucket: long liquidations (forced sells) above
// the zero line, short liquidations (forced buys) below, in quote notional.

const BUCKETS = [
  { value: 15, label: "15s" },
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
] as const;
type BucketSeconds = (typeof BUCKETS)[number]["value"];
const SUMMARY_WINDOW_MS = 5 * 60_000;
const BUCKET_COUNT = 60;

export const usd = (value: number, digits = 1) => `$${formatCompact(value, digits)}`;

export default function LiquidationsPanel() {
  const liquidations = useSessionStore((s) => s.liquidations);
  const flowBars = useSessionStore((s) => s.flowBars);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);
  const tickSize = useSessionStore((s) => s.tickSize);
  const [bucketSec, setBucketSec] = useState<BucketSeconds>(60);
  const now = useMarketNow(1000);
  const visibleRef = useRef<{ buckets: LiquidationBucket[]; slot: number; plotR: number }>({ buckets: [], slot: 0, plotR: 0 });

  const feedVenues = selectedVenues.filter((v) => LIQUIDATION_FEED_VENUES.has(v));
  const bucketMs = bucketSec * 1000;
  const bucketCount = BUCKET_COUNT;
  const buckets = useMemo(
    () => bucketLiquidations(liquidations, bucketMs, bucketCount, now),
    [liquidations, bucketMs, bucketCount, now]
  );
  const prices = useMemo(() => {
    const bars = resampleBars(flowBars, bucketSec);
    const byTime = new Map(bars.map((b) => [b.time, b.close]));
    return buckets.map((b) => byTime.get(b.time));
  }, [flowBars, bucketSec, buckets]);
  const decimals = priceDecimals(tickSize, flowBars[flowBars.length - 1]?.close);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, p: Palette) => {
      ctx.fillStyle = p.bgPanel;
      ctx.fillRect(0, 0, W, H);
      const plotR = W - STUDY_AXIS_W;
      const plotT = 8;
      const plotB = H - STUDY_TIME_H;
      if (!feedVenues.length) {
        drawEmpty(ctx, W, H, "No public liquidation feed for the selected venue", p);
        visibleRef.current = { buckets: [], slot: 0, plotR };
        return;
      }
      const slot = plotR / buckets.length;
      let max = 0;
      for (const b of buckets) max = Math.max(max, b.longNotional, b.shortNotional);
      if (max === 0) max = 1;
      const range = max * 1.15;
      const mid = (plotT + plotB) / 2;
      const half = (plotB - plotT) / 2;
      const yOf = (v: number) => mid - (v / range) * half;
      drawValueAxis(ctx, -range, range, yOf, plotR, plotT, plotB, W, p, (v) => usd(Math.abs(v), 0), 4);

      ctx.fillStyle = p.border;
      ctx.fillRect(0, Math.round(mid), plotR, 1);

      const barW = Math.max(1, slot * 0.72);
      buckets.forEach((b, i) => {
        const x = i * slot + (slot - barW) / 2;
        if (b.longNotional > 0) {
          const h = Math.max(1, mid - yOf(b.longNotional));
          ctx.fillStyle = withAlpha(p.sell, 0.85);
          ctx.fillRect(x, mid - h, barW, h);
        }
        if (b.shortNotional > 0) {
          const h = Math.max(1, yOf(-b.shortNotional) - mid);
          ctx.fillStyle = withAlpha(p.buy, 0.85);
          ctx.fillRect(x, mid + 1, barW, h);
        }
      });

      // Price overlay on its own scale, for context.
      const known = prices.filter((v): v is number => v !== undefined);
      if (known.length > 1) {
        const pMin = Math.min(...known);
        const pMax = Math.max(...known);
        const pad = (pMax - pMin) * 0.1 || pMax * 0.0005 || 1;
        const pyOf = (v: number) => plotT + ((pMax + pad - v) / (pMax - pMin + 2 * pad)) * (plotB - plotT);
        ctx.beginPath();
        let started = false;
        prices.forEach((v, i) => {
          if (v === undefined) return;
          const x = i * slot + slot / 2;
          if (started) ctx.lineTo(x, pyOf(v));
          else { ctx.moveTo(x, pyOf(v)); started = true; }
        });
        ctx.strokeStyle = withAlpha(p.text, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.font = monoFont(9, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = withAlpha(p.sell, 0.9);
      ctx.fillText("LONGS LIQUIDATED", 6, plotT + 6);
      ctx.fillStyle = withAlpha(p.buy, 0.9);
      ctx.fillText("SHORTS LIQUIDATED", 6, plotB - 8);

      drawTimeAxis(ctx, buckets.map((b) => b.time), (i) => i * slot + slot / 2, plotB, W, p, bucketSec < 60);
      visibleRef.current = { buckets, slot, plotR };
    },
    [buckets, prices, feedVenues.length, bucketSec]
  );

  const { containerRef, canvasRef } = useCanvas(draw);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { buckets: shown, slot, plotR } = visibleRef.current;
    if (!shown.length || x > plotR) return hideTooltip();
    const i = Math.floor(x / slot);
    const b = shown[i];
    if (!b) return hideTooltip();
    const price = prices[i];
    showTooltip(
      `Liquidations ${formatClock(b.time)}`,
      [
        `Longs: ${usd(b.longNotional, 2)} (${formatCompact(b.longQty, 3)})`,
        `Shorts: ${usd(b.shortNotional, 2)} (${formatCompact(b.shortQty, 3)})`,
        `Orders: ${b.count}`,
        ...(price !== undefined ? [`Price: ${formatPriceValue(price, decimals)}`] : []),
        "",
        "What this means: Long liquidations are forced sells and push price down; short liquidations are forced buys. Clusters often mark exhaustion of a move.",
      ].join("\n"),
      e
    );
  };

  const summary = useMemo(() => summarizeLiquidations(liquidations, now - SUMMARY_WINDOW_MS), [liquidations, now]);
  const sessionTotal = useMemo(() => liquidations.reduce((s, l) => s + l.quoteVolume, 0), [liquidations]);
  const cascade = isLiquidationCascade(buckets, 5);
  const latestActive = buckets.length > 0 && buckets[buckets.length - 1].count > 0;
  const missing = selectedVenues.filter((v) => !LIQUIDATION_FEED_VENUES.has(v));

  return (
    <Panel
      title="Liquidations" icon={<Icon.Flame />}
      subtitle={
        feedVenues.length
          ? `forced closes · ${feedVenues.map((v) => VENUE_LABEL[v] ?? v).join(", ")}${missing.length ? ` (no feed: ${missing.map((v) => VENUE_LABEL[v] ?? v).join(", ")})` : ""}`
          : "forced closes"
      }
      value={
        <>
          <span className="tone-warn">{sessionTotal ? usd(sessionTotal) : "—"}</span>
          {feedVenues.length > 0 && (
            <span
              className={`liq-state ${cascade ? "is-cascade" : latestActive ? "is-active" : ""}`}
              title="Cascade: the latest bucket is at least 5× the median non-empty bucket"
            >
              {cascade ? "Cascade" : latestActive ? "Active" : "Quiet"}
            </span>
          )}
        </>
      }
      actions={<Segmented size="xs" value={bucketSec} onChange={setBucketSec} options={BUCKETS} ariaLabel="Bucket size" />}
      footer={
        <div className="study-stats">
          <Stat label="Longs 5m" value={usd(summary.longNotional)} tone="sell" />
          <Stat label="Shorts 5m" value={usd(summary.shortNotional)} tone="buy" />
          <Stat
            label="Largest 5m"
            value={summary.largest ? usd(summary.largest.quoteVolume) : "—"}
            sub={summary.largest ? `${summary.largest.side} · ${formatPriceValue(summary.largest.price, decimals)}` : undefined}
            tone={summary.largest ? (summary.largest.side === "long" ? "sell" : "buy") : "muted"}
          />
        </div>
      }
    >
      <div ref={containerRef} className="canvas-host" onMouseMove={handleMove} onMouseLeave={hideTooltip}>
        <canvas ref={canvasRef} />
      </div>
    </Panel>
  );
}
