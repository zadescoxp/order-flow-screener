"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import type { FootprintCandle, FootprintLevel } from "@/lib/types/market";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Footprint Chart — Canvas Renderer ─────────────────────────────
// This renders the actual price×time×volume footprint chart.
// Each candle column shows bid/ask volume at every price level.
// The canvas is fully redrawn on every state change.

const CANDLE_WIDTH = 120; // px per candle
const LEVEL_HEIGHT = 14; // px per price level row
const PRICE_COL_WIDTH = 60; // left price axis
const DELTA_ROW_HEIGHT = 18; // delta bar below candle
const SCROLL_PADDING = 40; // right padding

// Imbalance colors
const COLOR_ASK_IMBALANCE = "rgba(38,166,154,0.25)";
const COLOR_BID_IMBALANCE = "rgba(239,83,80,0.25)";
const COLOR_STACKED_ASK = "rgba(38,166,154,0.5)";
const COLOR_STACKED_BID = "rgba(239,83,80,0.5)";

// Z-score volume bar colors
function zScoreColor(z: number): string {
  if (z >= 3) return "rgba(255,68,68,0.3)";
  if (z >= 2) return "rgba(255,136,0,0.25)";
  if (z >= 1) return "rgba(255,204,0,0.18)";
  return "rgba(68,68,102,0.0)";
}

function deltaColor(delta: number): string {
  return delta >= 0 ? "#26a69a" : "#ef5350";
}

function formatVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v.toFixed(v < 1 ? 2 : 0);
}

interface FootprintChartProps {
  height: number;
}

export default function FootprintChart({ height }: FootprintChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);
  const scrollYRef = useRef(0);
  const zoomRef = useRef(20); // adjustable LEVEL_HEIGHT
  const isLockedToRightRef = useRef(true);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scroll: 0, scrollY: 0 });

  const candles = useTerminalStore((s) => s.candles);
  const currentCandle = useTerminalStore((s) => s.currentCandle);
  const tickSize = useTerminalStore((s) => s.tickSize);
  const setCrosshair = useTerminalStore((s) => s.setCrosshair);

  const allCandles = [...candles, ...(currentCandle ? [currentCandle] : [])];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const rootStyles = getComputedStyle(document.documentElement);
    const bgBase = rootStyles.getPropertyValue('--bg-base').trim() || "#0a0a0c";
    const bgPanel = rootStyles.getPropertyValue('--bg-panel').trim() || "#111116";
    const border = rootStyles.getPropertyValue('--border').trim() || "#1e1e2a";
    const textPrimary = rootStyles.getPropertyValue('--text-primary').trim() || "#e8e8f0";
    const textMuted = rootStyles.getPropertyValue('--text-muted').trim() || "#8a8a99";
    const textSecondary = rootStyles.getPropertyValue('--text-secondary').trim() || "#caced0";
    const buyColor = rootStyles.getPropertyValue('--buy').trim() || "#26a69a";
    const sellColor = rootStyles.getPropertyValue('--sell').trim() || "#ef5350";

    const addAlpha = (hex: string, alpha: number) => {
      if (!hex.startsWith('#')) return hex;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };

    ctx.fillStyle = bgBase;
    ctx.fillRect(0, 0, W, H);

    if (allCandles.length === 0) return; // handled by HTML overlay

    const LEVEL_HEIGHT = zoomRef.current;
    const CANDLE_WIDTH = 120;
    const PRICE_COL_WIDTH = 60;
    
    // Bottom table rows: Volume, Delta, Cum Delta
    const BOTTOM_TABLE_HEIGHT = 50; 
    
    const allPrices = new Set<number>();
    for (const c of allCandles) {
      for (const p of c.sortedPrices) allPrices.add(p);
    }
    const sortedPrices = [...allPrices].sort((a, b) => b - a);
    if (sortedPrices.length === 0) return;

    const totalHeight = sortedPrices.length * LEVEL_HEIGHT;
    const chartH = H - BOTTOM_TABLE_HEIGHT;

    // Center vertically if it fits, otherwise allow scrolling
    const baseTopOffset = Math.max(0, (chartH - totalHeight) / 2);
    const maxScrollY = Math.max(0, totalHeight - chartH + 40);
    const scrollY = Math.min(Math.max(0, scrollYRef.current), maxScrollY);
    scrollYRef.current = scrollY;
    const topOffset = baseTopOffset - scrollY;

    const totalWidth = allCandles.length * CANDLE_WIDTH + PRICE_COL_WIDTH + 150; // extra padding on right
    const maxScroll = Math.max(0, totalWidth - W + PRICE_COL_WIDTH);
    
    if (isLockedToRightRef.current) {
      scrollRef.current = maxScroll;
    }
    
    const scroll = Math.min(Math.max(0, scrollRef.current), maxScroll);
    scrollRef.current = scroll;
    
    if (scroll === maxScroll) {
      isLockedToRightRef.current = true;
    }

    const priceIndex = new Map<number, number>();
    sortedPrices.forEach((p, i) => priceIndex.set(p, i));

    // Draw candles
    const startCandle = Math.floor(scroll / CANDLE_WIDTH);
    const endCandle = Math.min(allCandles.length - 1, startCandle + Math.ceil((W - PRICE_COL_WIDTH) / CANDLE_WIDTH) + 1);

    ctx.font = `${Math.max(9, LEVEL_HEIGHT * 0.45)}px monospace`;

    for (let ci = startCandle; ci <= endCandle; ci++) {
      const candle = allCandles[ci];
      if (!candle) continue;

      const x = PRICE_COL_WIDTH + ci * CANDLE_WIDTH - scroll;
      if (x + CANDLE_WIDTH < PRICE_COL_WIDTH || x > W) continue;

      // Candle header (time)
      const date = new Date(candle.openTime);
      const timeStr = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
      ctx.fillStyle = border;
      ctx.fillRect(x, 0, CANDLE_WIDTH - 1, 14);
      ctx.fillStyle = textMuted;
      ctx.textAlign = "center";
      ctx.fillText(timeStr, x + CANDLE_WIDTH / 2, 11);

      // Draw each price level
      for (const [price, level] of candle.levels) {
        const pi = priceIndex.get(price);
        if (pi === undefined) continue;
        const y = 14 + topOffset + pi * LEVEL_HEIGHT;
        if (y < 14 || y > chartH) continue;

        // NinjaTrader style background based on dominant volume
        const isAskDom = level.askVolume > level.bidVolume;
        const intensity = candle.maxVolumeAtLevel > 0 ? (level.totalVolume / candle.maxVolumeAtLevel) : 0;
        
        // Colors for cell: green if ask > bid, red if bid > ask
        const alpha = 0.1 + (intensity * 0.5); // min 0.1, max 0.6 opacity
        ctx.fillStyle = addAlpha(isAskDom ? buyColor : sellColor, alpha);
        ctx.fillRect(x + 1, y, CANDLE_WIDTH - 2, LEVEL_HEIGHT - 1);

        // Text: bid x ask
        const bidStr = formatVol(level.bidVolume);
        const askStr = formatVol(level.askVolume);
        const textStr = `${bidStr} x ${askStr}`;
        const textY = y + LEVEL_HEIGHT / 2 + (LEVEL_HEIGHT * 0.15);

        ctx.fillStyle = level.totalVolume === candle.maxVolumeAtLevel ? textPrimary : textSecondary;
        ctx.textAlign = "center";
        ctx.fillText(textStr, x + CANDLE_WIDTH / 2, textY);

        // Outline POC (Point of Control)
        if (level.totalVolume === candle.maxVolumeAtLevel && level.totalVolume > 0) {
          ctx.strokeStyle = textPrimary;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y, CANDLE_WIDTH - 2, LEVEL_HEIGHT - 1);
        }
      }

      // Bottom Table: Delta, Cum Delta, Volume
      const tableY = H - BOTTOM_TABLE_HEIGHT;
      const rowH = BOTTOM_TABLE_HEIGHT / 3;

      // Values
      const deltaStr = candle.delta.toFixed(1);
      const cumDeltaStr = candle.cumulativeDelta.toFixed(1);
      const volStr = candle.volume.toFixed(1);

      ctx.textAlign = "right";
      
      // Delta
      ctx.fillStyle = candle.delta >= 0 ? addAlpha(buyColor, 0.15) : addAlpha(sellColor, 0.15);
      ctx.fillRect(x, tableY, CANDLE_WIDTH - 1, rowH);
      ctx.fillStyle = candle.delta >= 0 ? buyColor : sellColor;
      ctx.fillText(deltaStr, x + CANDLE_WIDTH - 4, tableY + rowH - 4);

      // Cum Delta
      ctx.fillStyle = candle.cumulativeDelta >= 0 ? addAlpha(buyColor, 0.15) : addAlpha(sellColor, 0.15);
      ctx.fillRect(x, tableY + rowH, CANDLE_WIDTH - 1, rowH);
      ctx.fillStyle = candle.cumulativeDelta >= 0 ? buyColor : sellColor;
      ctx.fillText(cumDeltaStr, x + CANDLE_WIDTH - 4, tableY + rowH * 2 - 4);

      // Volume
      ctx.fillStyle = border;
      ctx.fillRect(x, tableY + rowH * 2, CANDLE_WIDTH - 1, rowH);
      ctx.fillStyle = textSecondary;
      ctx.fillText(volStr, x + CANDLE_WIDTH - 4, tableY + rowH * 3 - 4);

      // Column separator
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + CANDLE_WIDTH - 1, 0);
      ctx.lineTo(x + CANDLE_WIDTH - 1, H);
      ctx.stroke();
    }

    // Draw Y-Axis (Prices)
    ctx.fillStyle = bgBase;
    ctx.fillRect(0, 0, PRICE_COL_WIDTH, H);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PRICE_COL_WIDTH, 0);
    ctx.lineTo(PRICE_COL_WIDTH, H);
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.textAlign = "right";
    for (let i = 0; i < sortedPrices.length; i++) {
      const y = 14 + topOffset + i * LEVEL_HEIGHT + Math.max(9, LEVEL_HEIGHT * 0.45);
      if (y < 20 || y > chartH) continue;
      ctx.fillText(sortedPrices[i].toLocaleString("en-US", { minimumFractionDigits: 1 }), PRICE_COL_WIDTH - 4, y - (LEVEL_HEIGHT * 0.2));
      
      // grid line
      ctx.strokeStyle = "rgba(30,30,42,0.3)";
      ctx.beginPath();
      ctx.moveTo(PRICE_COL_WIDTH, 14 + topOffset + i * LEVEL_HEIGHT);
      ctx.lineTo(W, 14 + topOffset + i * LEVEL_HEIGHT);
      ctx.stroke();
    }

    // Live ticker price line
    const ticker = useTerminalStore.getState().ticker;
    if (ticker && sortedPrices.length > 0) {
      // Find exact Y coordinate based on interpolation between known ticks or simple index
      // But ticks are rounded. Let's find the nearest level or approximate
      const maxPrice = sortedPrices[0];
      const tickSize = useTerminalStore.getState().tickSize;
      
      // Calculate continuous Y position
      const priceDiff = maxPrice - ticker.price;
      const ticksDown = priceDiff / tickSize;
      const currentPriceY = 14 + topOffset + ticksDown * LEVEL_HEIGHT + (LEVEL_HEIGHT / 2);
      
      if (currentPriceY >= 14 && currentPriceY <= chartH) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(PRICE_COL_WIDTH, currentPriceY);
        ctx.lineTo(W, currentPriceY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw price label on Y-axis
        ctx.fillStyle = textPrimary;
        ctx.fillRect(0, currentPriceY - 7, PRICE_COL_WIDTH, 14);
        ctx.fillStyle = bgBase;
        ctx.font = "bold 9px monospace";
        ctx.fillText(ticker.price.toLocaleString("en-US", { minimumFractionDigits: 1 }), PRICE_COL_WIDTH - 4, currentPriceY + 3);
      }
    }

    // Bottom Table Labels on Y-Axis
    const tableY = H - BOTTOM_TABLE_HEIGHT;
    const rowH = BOTTOM_TABLE_HEIGHT / 3;
    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, tableY, PRICE_COL_WIDTH, BOTTOM_TABLE_HEIGHT);
    ctx.fillStyle = textSecondary;
    ctx.textAlign = "left";
    ctx.font = "9px monospace";
    ctx.fillText("Delta", 4, tableY + rowH - 4);
    ctx.fillText("Cum D.", 4, tableY + rowH * 2 - 4);
    ctx.fillText("Vol", 4, tableY + rowH * 3 - 4);

    // Separator above bottom table
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(0, tableY);
    ctx.lineTo(W, tableY);
    ctx.stroke();

  }, [allCandles, tickSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = height;
    draw();
  }, [draw, height]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const obs = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = height;
      draw();
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [draw, height]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        // Zoom Y axis
        const zoomDelta = e.deltaY * -0.05;
        zoomRef.current = Math.min(Math.max(10, zoomRef.current + zoomDelta), 50);
      } else {
        // Pan X and Y axis
        scrollRef.current += e.deltaX;
        scrollYRef.current += e.deltaY;
        isLockedToRightRef.current = false;
      }
      draw();
    },
    [draw]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    isLockedToRightRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY, scroll: scrollRef.current, scrollY: scrollYRef.current };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        scrollRef.current = dragStartRef.current.scroll - dx;
        scrollYRef.current = dragStartRef.current.scrollY - dy;
        draw();
        hideTooltip();
        return;
      }

      // Crosshair sync
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const LEVEL_HEIGHT = zoomRef.current;
      const CANDLE_WIDTH = 120;
      const PRICE_COL_WIDTH = 60;
      const BOTTOM_TABLE_HEIGHT = 50;
      const chartH = canvas.height - BOTTOM_TABLE_HEIGHT;

      // Determine candle and price from cursor position
      const candleIndex = Math.floor((x - PRICE_COL_WIDTH + scrollRef.current) / CANDLE_WIDTH);
      const candle = allCandles[candleIndex];
      
      if (candle) {
        const allPrices = new Set<number>();
        for (const c of allCandles) {
          for (const p of c.sortedPrices) allPrices.add(p);
        }
        const sortedPrices = [...allPrices].sort((a, b) => b - a);
        const totalHeight = sortedPrices.length * LEVEL_HEIGHT;
        const baseTopOffset = Math.max(0, (chartH - totalHeight) / 2);
        const maxScrollY = Math.max(0, totalHeight - chartH + 40);
        const scrollY = Math.min(Math.max(0, scrollYRef.current), maxScrollY);
        const topOffset = baseTopOffset - scrollY;
        
        // Are we in the bottom table area?
        if (y >= chartH) {
           const title = "Candle Summary Metrics";
           const content = `Delta: ${candle.delta.toFixed(1)} (Net Buying/Selling Pressure)\nCum Delta: ${candle.cumulativeDelta.toFixed(1)} (Session Trend)\nTotal Volume: ${candle.volume.toFixed(1)}\n\nWhat this means: Delta shows who is in control for this candle. Positive means aggressive buyers, negative means aggressive sellers.`;
           showTooltip(title, content, e);
           setCrosshair(candle.openTime, null);
           return;
        }

        const priceIndex = Math.floor((y - 14 - topOffset) / LEVEL_HEIGHT);
        const price = sortedPrices[priceIndex];
        if (price !== undefined) {
          setCrosshair(candle.openTime, price);
          const level = candle.levels.get(price);
          if (level) {
            const title = `Price Level: ${price.toLocaleString()}`;
            const isBuyDom = level.askVolume > level.bidVolume;
            const domText = isBuyDom ? "Buyers (Asks)" : "Sellers (Bids)";
            const content = `Bid Vol: ${level.bidVolume.toFixed(2)}\nAsk Vol: ${level.askVolume.toFixed(2)}\nTotal Vol: ${level.totalVolume.toFixed(2)}\n\nWhat this means: This block shows market orders executed here. ${domText} were more aggressive, creating a ${isBuyDom ? 'positive' : 'negative'} delta of ${(level.askVolume - level.bidVolume).toFixed(2)}.`;
            showTooltip(title, content, e);
          } else {
            hideTooltip();
          }
        } else {
          hideTooltip();
        }
      } else {
        hideTooltip();
      }
    },
    [draw, allCandles, setCrosshair]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      style={{ width: "100%", height, position: "relative" }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      {allCandles.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          <div className="spinner" style={{ marginBottom: 16 }} />
          <div style={{ fontSize: 11 }}>Connecting to live data stream…</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>
            Waiting for trade data
          </div>
        </div>
      )}
    </div>
  );
}
