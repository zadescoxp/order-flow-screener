"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";

// ─── Depth of Market (Canvas) ───────────────────────────────────
// Cumulative bid/ask depth curve, synchronized with crosshair.

export default function DepthOfMarket() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orderBook = useTerminalStore((s) => s.orderBook);
  const crosshairPrice = useTerminalStore((s) => s.crosshairPrice);
  const ticker = useTerminalStore((s) => s.ticker);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, W, H);

    if (!orderBook || !ticker) {
      ctx.fillStyle = "#4a4a66";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for order book…", W / 2, H / 2);
      return;
    }

    const midPrice = ticker.price;

    // Build cumulative bid/ask arrays
    const bids = orderBook.bids.slice(0, 50);
    const asks = orderBook.asks.slice(0, 50);

    if (bids.length === 0 || asks.length === 0) return;

    const minPrice = bids[bids.length - 1]?.price ?? midPrice * 0.98;
    const maxPrice = asks[asks.length - 1]?.price ?? midPrice * 1.02;
    const priceRange = maxPrice - minPrice;

    if (priceRange <= 0) return;

    const priceToX = (p: number) => ((p - minPrice) / priceRange) * W;

    // Cumulative bids (from mid price going left)
    let cumBid = 0;
    const bidPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < bids.length; i++) {
      cumBid += bids[i].size;
      bidPoints.push({ x: priceToX(bids[i].price), y: cumBid });
    }

    // Cumulative asks (from mid price going right)
    let cumAsk = 0;
    const askPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < asks.length; i++) {
      cumAsk += asks[i].size;
      askPoints.push({ x: priceToX(asks[i].price), y: cumAsk });
    }

    const maxCum = Math.max(cumBid, cumAsk);
    const volToY = (v: number) => H - (v / maxCum) * (H - 20) - 4;

    // Draw bid area
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), H);
    for (let i = 0; i < bidPoints.length; i++) {
      const { x, y } = bidPoints[i];
      ctx.lineTo(x, volToY(y));
    }
    ctx.lineTo(bidPoints[bidPoints.length - 1]?.x ?? 0, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(38,166,154,0.15)";
    ctx.fill();

    // Bid outline
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), volToY(0));
    for (const { x, y } of bidPoints) {
      ctx.lineTo(x, volToY(y));
    }
    ctx.strokeStyle = "#26a69a";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw ask area
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), H);
    for (const { x, y } of askPoints) {
      ctx.lineTo(x, volToY(y));
    }
    ctx.lineTo(askPoints[askPoints.length - 1]?.x ?? W, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(239,83,80,0.15)";
    ctx.fill();

    // Ask outline
    ctx.beginPath();
    ctx.moveTo(priceToX(midPrice), volToY(0));
    for (const { x, y } of askPoints) {
      ctx.lineTo(x, volToY(y));
    }
    ctx.strokeStyle = "#ef5350";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mid price line
    const midX = priceToX(midPrice);
    ctx.strokeStyle = "rgba(124,106,245,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Crosshair price line
    if (crosshairPrice !== null) {
      const cx = priceToX(crosshairPrice);
      if (cx >= 0 && cx <= W) {
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();
      }
    }

    // Price labels on X axis
    ctx.fillStyle = "#4a4a66";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const labelStep = Math.ceil(priceRange / 8 / 10) * 10;
    for (
      let p = Math.ceil(minPrice / labelStep) * labelStep;
      p <= maxPrice;
      p += labelStep
    ) {
      const x = priceToX(p);
      ctx.fillText(p.toLocaleString("en-US"), x, H - 2);
    }

    // Volume labels
    ctx.textAlign = "right";
    ctx.fillStyle = "#4a4a66";
    const maxCumM = maxCum / 1e6;
    for (let i = 1; i <= 3; i++) {
      const v = (maxCum / 4) * i;
      const y = volToY(v);
      ctx.fillText(
        v >= 1e6
          ? `${(v / 1e6).toFixed(0)}M`
          : v >= 1000
          ? `${(v / 1000).toFixed(0)}K`
          : v.toFixed(0),
        W - 2,
        y
      );
    }

    // Legend
    const bidTotal = cumBid;
    const askTotal = cumAsk;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#26a69a";
    ctx.fillText(
      `■ Bids ${bidTotal >= 1e6 ? (bidTotal / 1e6).toFixed(1) + "M" : (bidTotal / 1000).toFixed(0) + "K"}`,
      4,
      12
    );
    ctx.fillStyle = "#ef5350";
    ctx.fillText(
      `■ Asks ${askTotal >= 1e6 ? (askTotal / 1e6).toFixed(1) + "M" : (askTotal / 1000).toFixed(0) + "K"}`,
      4,
      22
    );
  }, [orderBook, crosshairPrice, ticker]);

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
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
    </div>
  );
}
