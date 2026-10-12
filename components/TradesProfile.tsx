"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

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
  const theme = useTerminalStore((s) => s.theme);
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

    const cs = getComputedStyle(document.documentElement);
    const bgPanel   = cs.getPropertyValue("--bg-surface").trim()  || "#0f0f12";
    const textMuted  = cs.getPropertyValue("--text-muted").trim() || "#4a4a66";
    const highlight  = cs.getPropertyValue("--highlight").trim()   || "#7c6af5";
    const buy        = cs.getPropertyValue("--buy").trim()          || "#26a69a";
    const sell       = cs.getPropertyValue("--sell").trim()         || "#ef5350";
    const borderMuted = cs.getPropertyValue("--border-muted").trim() || "#13131a";

    const hex2rgba = (hex: string, a: number) => {
      if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    };

    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, 0, W, H);

    if (profile.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No trades yet", W / 2, H / 2);
      return;
    }

    const rowH = Math.max(2, Math.floor(H / profile.length));
    const maxVal = Math.max(
      ...profile.map((l) => tab === "volume" ? l.totalVol : l.totalTrades)
    );
    const BAR_W = W - 4;

    for (let i = 0; i < profile.length; i++) {
      const level = profile[i];
      const y = i * rowH;

      if (crosshairPrice !== null && Math.abs(level.price - crosshairPrice) < tickSize) {
        ctx.fillStyle = hex2rgba(highlight, 0.1);
        ctx.fillRect(0, y, W, rowH);
      }

      if (tab === "volume") {
        const buyW = (level.buyVol / maxVal) * BAR_W;
        const sellW = (level.sellVol / maxVal) * BAR_W;
        ctx.fillStyle = buy;
        ctx.fillRect(0, y + 1, buyW, rowH - 2);
        ctx.fillStyle = sell;
        ctx.fillRect(buyW, y + 1, sellW, rowH - 2);
      } else {
        const buyW = (level.buyTrades / maxVal) * BAR_W;
        const sellW = (level.sellTrades / maxVal) * BAR_W;
        ctx.fillStyle = hex2rgba(buy, 0.7);
        ctx.fillRect(0, y + 1, buyW, rowH - 2);
        ctx.fillStyle = hex2rgba(sell, 0.7);
        ctx.fillRect(buyW, y + 1, sellW, rowH - 2);
      }

      ctx.strokeStyle = borderMuted;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }, [profile, crosshairPrice, tab, tickSize, theme]);

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
    if (!canvas || profile.length === 0) {
      hideTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rowH = Math.max(2, Math.floor(canvas.height / profile.length));
    const index = Math.floor(y / rowH);
    const level = profile[index];
    
    if (level) {
      const title = `Recent Trades at ${level.price.toLocaleString()}`;
      let content = "";
      if (tab === "volume") {
         content = `Buy Vol: ${level.buyVol.toFixed(2)}\nSell Vol: ${level.sellVol.toFixed(2)}\nTotal Vol: ${level.totalVol.toFixed(2)}\n\nWhat this means: This shows the total volume of market orders filled at this price recently.`;
      } else {
         content = `Buy Trades: ${level.buyTrades}\nSell Trades: ${level.sellTrades}\nTotal Trades: ${level.totalTrades}\n\nWhat this means: This shows the NUMBER of individual market orders executed at this price recently.`;
      }
      showTooltip(title, content, e);
    } else {
      hideTooltip();
    }
  }, [profile, tab]);

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
