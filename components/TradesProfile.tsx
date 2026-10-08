"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";

// ─── Trades Profile Panel (Canvas) ─────────────────────────────
// Horizontal profile of executed trades at each price level.
// Toggle between Volume and Trade count.

type TradesTab = "volume" | "trades";

export default function TradesProfilePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentTrades = useTerminalStore((s) => s.recentTrades);
  const crosshairPrice = useTerminalStore((s) => s.crosshairPrice);
  const tickSize = useTerminalStore((s) => s.tickSize);
  const [tab, setTab] = useState<TradesTab>("volume");

  // Aggregate trades by price level
  const profile = React.useMemo(() => {
    const map = new Map<number, { buyVol: number; sellVol: number; buyTrades: number; sellTrades: number }>();

    for (const t of recentTrades) {
      const rounded = Math.round(t.price / tickSize) * tickSize;
      const existing = map.get(rounded) ?? { buyVol: 0, sellVol: 0, buyTrades: 0, sellTrades: 0 };
      if (t.side === "buy") {
        existing.buyVol += t.quantity;
        existing.buyTrades += 1;
      } else {
        existing.sellVol += t.quantity;
        existing.sellTrades += 1;
      }
      map.set(rounded, existing);
    }

    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([price, d]) => ({
        price,
        ...d,
        totalVol: d.buyVol + d.sellVol,
        totalTrades: d.buyTrades + d.sellTrades,
      }));
  }, [recentTrades, tickSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f0f12";
    ctx.fillRect(0, 0, W, H);

    if (profile.length === 0) {
      ctx.fillStyle = "#4a4a66";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No trades yet", W / 2, H / 2);
      return;
    }

    const rowH = Math.max(2, Math.floor(H / profile.length));
    const maxVal = Math.max(
      ...profile.map((l) =>
        tab === "volume" ? l.totalVol : l.totalTrades
      )
    );
    const BAR_W = W - 4;

    for (let i = 0; i < profile.length; i++) {
      const level = profile[i];
      const y = i * rowH;

      // Crosshair highlight
      if (crosshairPrice !== null && Math.abs(level.price - crosshairPrice) < tickSize) {
        ctx.fillStyle = "rgba(124,106,245,0.1)";
        ctx.fillRect(0, y, W, rowH);
      }

      if (tab === "volume") {
        const buyW = (level.buyVol / maxVal) * BAR_W;
        const sellW = (level.sellVol / maxVal) * BAR_W;
        ctx.fillStyle = "#26a69a";
        ctx.fillRect(0, y + 1, buyW, rowH - 2);
        ctx.fillStyle = "#ef5350";
        ctx.fillRect(buyW, y + 1, sellW, rowH - 2);
      } else {
        const buyW = (level.buyTrades / maxVal) * BAR_W;
        const sellW = (level.sellTrades / maxVal) * BAR_W;
        ctx.fillStyle = "rgba(38,166,154,0.7)";
        ctx.fillRect(0, y + 1, buyW, rowH - 2);
        ctx.fillStyle = "rgba(239,83,80,0.7)";
        ctx.fillRect(buyW, y + 1, sellW, rowH - 2);
      }

      // Row separator
      ctx.strokeStyle = "#13131a";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }, [profile, crosshairPrice, tab, tickSize]);

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
        <span className="panel-title">Trades Profile</span>
        <div className="tab-group" style={{ gap: 0 }}>
          <button
            className={`tab ${tab === "volume" ? "active" : ""}`}
            onClick={() => setTab("volume")}
            style={{ padding: "1px 5px", fontSize: 9 }}
          >
            Volume
          </button>
          <button
            className={`tab ${tab === "trades" ? "active" : ""}`}
            onClick={() => setTab("trades")}
            style={{ padding: "1px 5px", fontSize: 9 }}
          >
            Trades
          </button>
        </div>
      </div>
      <div ref={containerRef} className="panel-content">
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>
    </div>
  );
}
