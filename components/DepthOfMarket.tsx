"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Depth of Market (Canvas) ───────────────────────────────────
// Cumulative bid/ask depth curve, synchronized with crosshair.

export default function DepthOfMarket() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orderBook = useTerminalStore((s) => s.orderBook);
  const crosshairPrice = useTerminalStore((s) => s.crosshairPrice);
  const ticker = useTerminalStore((s) => s.ticker);
  const theme = useTerminalStore((s) => s.theme);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cs = getComputedStyle(document.documentElement);
    const bgBase    = cs.getPropertyValue("--bg-base").trim()     || "#0a0a0c";
    const textMuted  = cs.getPropertyValue("--text-muted").trim() || "#4a4a66";
    const buy        = cs.getPropertyValue("--buy").trim()         || "#26a69a";
    const sell       = cs.getPropertyValue("--sell").trim()        || "#ef5350";
    const highlight  = cs.getPropertyValue("--highlight").trim()   || "#7c6af5";

    const hex2rgba = (hex: string, a: number) => {
      if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    };

    ctx.fillStyle = bgBase;
    ctx.fillRect(0, 0, W, H);

    if (!orderBook || !ticker) {
      ctx.fillStyle = textMuted;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for order book…", W / 2, H / 2);
      return;
    }

    const midPrice = ticker.price;

    const bids = orderBook.bids.slice(0, 50);
    const asks = orderBook.asks.slice(0, 50);

    if (bids.length === 0 || asks.length === 0) return;

    const minPrice = bids[bids.length - 1]?.price ?? midPrice * 0.98;
    const maxPrice = asks[asks.length - 1]?.price ?? midPrice * 1.02;
    const priceRange = maxPrice - minPrice;

    if (priceRange <= 0) return;

    const priceToX = (p: number) => ((p - minPrice) / priceRange) * W;

    let cumBid = 0;
    const bidPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < bids.length; i++) {
      cumBid += bids[i].size;
      bidPoints.push({ x: priceToX(bids[i].price), y: cumBid });
    }

    let cumAsk = 0;
    const askPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < asks.length; i++) {
      cumAsk += asks[i].size;
      askPoints.push({ x: priceToX(asks[i].price), y: cumAsk });
    }

    const maxCum = Math.max(cumBid, cumAsk);
    const volToY = (v: number) => H - (v / maxCum) * (H - 20) - 4;

    // Bid area
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), H);
    for (const { x, y } of bidPoints) ctx.lineTo(x, volToY(y));
    ctx.lineTo(bidPoints[bidPoints.length - 1]?.x ?? 0, H);
    ctx.closePath();
    ctx.fillStyle = hex2rgba(buy, 0.15);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), volToY(0));
    for (const { x, y } of bidPoints) ctx.lineTo(x, volToY(y));
    ctx.strokeStyle = buy;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Ask area
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), H);
    for (const { x, y } of askPoints) ctx.lineTo(x, volToY(y));
    ctx.lineTo(askPoints[askPoints.length - 1]?.x ?? W, H);
    ctx.closePath();
    ctx.fillStyle = hex2rgba(sell, 0.15);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), volToY(0));
    for (const { x, y } of askPoints) ctx.lineTo(x, volToY(y));
    ctx.strokeStyle = sell;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mid price line
    const midX = priceToX(midPrice);
    ctx.strokeStyle = hex2rgba(highlight, 0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    if (crosshairPrice !== null) {
      const cx = priceToX(crosshairPrice);
      if (cx >= 0 && cx <= W) {
        ctx.strokeStyle = hex2rgba(textMuted, 0.4);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();
      }
    }

    ctx.fillStyle = textMuted;
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const labelStep = Math.ceil(priceRange / 8 / 10) * 10;
    for (let p = Math.ceil(minPrice / labelStep) * labelStep; p <= maxPrice; p += labelStep) {
      ctx.fillText(p.toLocaleString("en-US"), priceToX(p), H - 2);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = textMuted;
    for (let i = 1; i <= 3; i++) {
      const v = (maxCum / 4) * i;
      const y = volToY(v);
      ctx.fillText(
        v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0),
        W - 2, y
      );
    }

    const fmt = (v: number) =>
      v >= 1_000_000 ? (v / 1_000_000).toFixed(2) + "M"
      : v >= 1_000   ? (v / 1_000).toFixed(2) + "K"
      : v.toFixed(4);
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = buy;
    ctx.fillText(`■ Bids ${fmt(cumBid)}`, 4, 12);
    ctx.fillStyle = sell;
    ctx.fillText(`■ Asks ${fmt(cumAsk)}`, 4, 22);
  }, [orderBook, crosshairPrice, ticker, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const obs = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !orderBook || !ticker) {
      hideTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const midPrice = ticker.price;
    const bids = orderBook.bids.slice(0, 50);
    const asks = orderBook.asks.slice(0, 50);
    if (bids.length === 0 || asks.length === 0) return;

    const minPrice = bids[bids.length - 1]?.price ?? midPrice * 0.98;
    const maxPrice = asks[asks.length - 1]?.price ?? midPrice * 1.02;
    const priceRange = maxPrice - minPrice;

    // Convert x back to price
    const hoveredPrice = minPrice + (x / canvas.width) * priceRange;

    // Is it a bid or ask?
    if (hoveredPrice < midPrice) {
      // Find closest bid
      let cumSize = 0;
      for (const b of bids) {
        cumSize += b.size;
        if (b.price <= hoveredPrice) break; // accumulated up to this price going down
      }
      showTooltip(
        `Bid Depth around ${hoveredPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
        `Cumulative Bid Size: ${cumSize.toFixed(2)}\n\nWhat this means: This is the total limit buy order size supporting the price from falling down to this level.`,
        e
      );
    } else {
      let cumSize = 0;
      for (const a of asks) {
        cumSize += a.size;
        if (a.price >= hoveredPrice) break; // accumulated up to this price going up
      }
      showTooltip(
        `Ask Depth around ${hoveredPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
        `Cumulative Ask Size: ${cumSize.toFixed(2)}\n\nWhat this means: This is the total limit sell order size blocking the price from rising up to this level.`,
        e
      );
    }
  }, [orderBook, ticker]);

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-title">Depth of Market</span>
        {orderBook && (
          <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
            {orderBook.venue.replace("-", " ").toUpperCase()}
          </span>
        )}
      </div>
      <div ref={containerRef} className="panel-content">
        <canvas 
          ref={canvasRef} 
          style={{ display: "block", cursor: "crosshair" }} 
          onMouseMove={handleMouseMove}
          onMouseLeave={hideTooltip}
        />
      </div>
    </div>
  );
}
