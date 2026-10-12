"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import { useUIStore } from "@/lib/store/uiStore";
import { scheduleCanvasRedraw } from "@/lib/session/canvasScheduler";
import type { NormalizedOrderBook, Venue } from "@/lib/types/market";

const COLUMN_COUNT = 600;
const ROW_COUNT = 121;
const COLUMN_MS = 1_000;
const BAND_TICKS = Math.floor(ROW_COUNT / 2);

interface HeatmapBuffer {
  buy: Float32Array;
  sell: Float32Array;
  liquidity: Float32Array;
  columnTimes: Float64Array;
  writeColumn: number;
  centerPrice: number;
  seenTrades: Set<string>;
}

function createBuffer(): HeatmapBuffer {
  return {
    buy: new Float32Array(COLUMN_COUNT * ROW_COUNT),
    sell: new Float32Array(COLUMN_COUNT * ROW_COUNT),
    liquidity: new Float32Array(COLUMN_COUNT * ROW_COUNT),
    columnTimes: new Float64Array(COLUMN_COUNT),
    writeColumn: -1,
    centerPrice: 0,
    seenTrades: new Set(),
  };
}

function percentile(values: Float32Array, level: number): number {
  const nonZero = Array.from(values).filter((value) => value > 0).sort((a, b) => a - b);
  return nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * level))] : 1;
}

function venueLabel(venue: Venue): string {
  return venue.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export default function HeatmapPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HeatmapBuffer>(createBuffer());
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const tradedVolume = useUIStore((state) => state.heatmap.tradedVolume);
  const restingLiquidity = useUIStore((state) => state.heatmap.restingLiquidity);
  const trades = useSessionStore((state) => state.recentTrades);
  const orderBooks = useSessionStore((state) => state.orderBooks);
  const aggregatedBook = useSessionStore((state) => state.aggregatedBook);
  const ticker = useSessionStore((state) => state.ticker);
  const tickSize = useSessionStore((state) => state.tickSize);
  const venue = useSessionStore((state) => state.venue);

  const reset = useCallback(() => {
    bufferRef.current = createBuffer();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buffer = bufferRef.current;
    const offscreen = offscreenRef.current ?? document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    offscreenRef.current = offscreen;
    const offscreenCtx = offscreen.getContext("2d");
    if (!offscreenCtx) return;
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--bg-base").trim() || "#0a0a0c";
    const muted = styles.getPropertyValue("--text-muted").trim() || "#4a4a66";
    const text = styles.getPropertyValue("--text-secondary").trim() || "#7a7a99";
    const buy = styles.getPropertyValue("--buy").trim() || "#26a69a";
    const sell = styles.getPropertyValue("--sell").trim() || "#ef5350";
    const left = 52;
    const top = 22;
    const plotWidth = Math.max(1, width - left);
    const plotHeight = Math.max(1, height - top - 18);
    const cellWidth = plotWidth / COLUMN_COUNT;
    const cellHeight = plotHeight / ROW_COUNT;
    const maxValue = Math.max(percentile(buffer.buy, 0.95), percentile(buffer.sell, 0.95), percentile(buffer.liquidity, 0.95));

    offscreenCtx.fillStyle = bg;
    offscreenCtx.fillRect(0, 0, width, height);
    for (let column = 0; column < COLUMN_COUNT; column++) {
      const sourceColumn = (buffer.writeColumn + 1 + column) % COLUMN_COUNT;
      const x = left + column * cellWidth;
      for (let row = 0; row < ROW_COUNT; row++) {
        const source = sourceColumn * ROW_COUNT + row;
        const volume = tradedVolume ? Math.max(buffer.buy[source], buffer.sell[source]) : 0;
        const liquidity = restingLiquidity ? buffer.liquidity[source] : 0;
        if (!volume && !liquidity) continue;
        const intensity = Math.min(1, Math.max(volume, liquidity) / maxValue);
        const color = liquidity ? (row < BAND_TICKS ? sell : buy) : (buffer.buy[source] >= buffer.sell[source] ? buy : sell);
        offscreenCtx.fillStyle = color.startsWith("#")
          ? `${color}${Math.max(20, Math.round(intensity * 180)).toString(16).padStart(2, "0")}`
          : color;
        offscreenCtx.fillRect(x, top + row * cellHeight, Math.ceil(cellWidth) + 1, Math.ceil(cellHeight) + 1);
      }
    }
    ctx.drawImage(offscreen, 0, 0);
    ctx.fillStyle = text;
    ctx.font = "10px monospace";
    ctx.fillText("HEATMAP", 8, 14);
    ctx.fillStyle = muted;
    ctx.fillText(`${COLUMN_COUNT}s window · ${tradedVolume ? "volume" : ""}${tradedVolume && restingLiquidity ? " + " : ""}${restingLiquidity ? "liquidity" : ""}`, left, height - 5);
    ctx.strokeStyle = muted;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, height - 18);
    ctx.stroke();
  }, [tradedVolume, restingLiquidity]);

  useEffect(() => {
    const buffer = bufferRef.current;
    for (const trade of trades) {
      if (buffer.seenTrades.has(trade.id)) continue;
      buffer.seenTrades.add(trade.id);
      if (buffer.seenTrades.size > 2_000) {
        const first = buffer.seenTrades.values().next().value;
        if (first) buffer.seenTrades.delete(first);
      }
      if (buffer.centerPrice === 0) buffer.centerPrice = trade.price;
      const columnTime = Math.floor(trade.timestamp / COLUMN_MS) * COLUMN_MS;
      if (buffer.writeColumn < 0 || buffer.columnTimes[buffer.writeColumn] !== columnTime) {
        buffer.writeColumn = (buffer.writeColumn + 1) % COLUMN_COUNT;
        buffer.columnTimes[buffer.writeColumn] = columnTime;
        const offset = buffer.writeColumn * ROW_COUNT;
        buffer.buy.fill(0, offset, offset + ROW_COUNT);
        buffer.sell.fill(0, offset, offset + ROW_COUNT);
        buffer.liquidity.fill(0, offset, offset + ROW_COUNT);
      }
      const row = Math.round((buffer.centerPrice + BAND_TICKS * tickSize - trade.price) / tickSize);
      if (row < 0 || row >= ROW_COUNT) continue;
      const index = buffer.writeColumn * ROW_COUNT + row;
      if (trade.side === "buy") buffer.buy[index] += trade.quoteVolume;
      else buffer.sell[index] += trade.quoteVolume;
    }
    scheduleCanvasRedraw(draw);
  }, [trades, tickSize, draw]);

  useEffect(() => {
    scheduleCanvasRedraw(draw);
  }, [draw]);

  useEffect(() => {
    reset();
    scheduleCanvasRedraw(draw);
  }, [reset, draw, ticker?.symbol, venue, tickSize]);

  useEffect(() => {
    if (!restingLiquidity) return;
    const sample = () => {
      const buffer = bufferRef.current;
      const book = venue === "all-perps" || venue === "all-spot" ? aggregatedBook : orderBooks[venue as Venue];
      if (!book) return;
      const mid = aggregatedBook?.midPrice ?? ((book.bids[0]?.price ?? 0) + (book.asks[0]?.price ?? 0)) / 2;
      if (!mid) return;
      if (!buffer.centerPrice) buffer.centerPrice = mid;
      buffer.writeColumn = (buffer.writeColumn + 1) % COLUMN_COUNT;
      buffer.columnTimes[buffer.writeColumn] = Date.now();
      const offset = buffer.writeColumn * ROW_COUNT;
      buffer.liquidity.fill(0, offset, offset + ROW_COUNT);
      for (const level of [...book.bids, ...book.asks]) {
        const row = Math.round((buffer.centerPrice + BAND_TICKS * tickSize - level.price) / tickSize);
        if (row >= 0 && row < ROW_COUNT) buffer.liquidity[offset + row] += level.size;
      }
      scheduleCanvasRedraw(draw);
    };
    sample();
    const timer = window.setInterval(sample, COLUMN_MS);
    return () => window.clearInterval(timer);
  }, [restingLiquidity, orderBooks, aggregatedBook, venue, tickSize, draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => scheduleCanvasRedraw(draw));
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const ranges = Object.values(orderBooks).filter(Boolean).map((book) => {
    const prices = [...(book as NormalizedOrderBook).bids, ...(book as NormalizedOrderBook).asks].map((level) => level.price);
    return `${venueLabel((book as NormalizedOrderBook).venue)} ${Math.min(...prices).toLocaleString()}–${Math.max(...prices).toLocaleString()}`;
  });

  return (
    <div ref={containerRef} className="canvas-container" style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      {restingLiquidity && ranges.length > 0 && (
        <div style={{ position: "absolute", right: 8, top: 4, color: "var(--text-muted)", fontSize: 9 }}>
          {ranges.join(" · ")}
        </div>
      )}
    </div>
  );
}
