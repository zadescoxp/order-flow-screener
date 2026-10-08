"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── OBI Panel (Order Book Imbalance) ───────────────────────────
// Displays current OBI value + historical OBI chart

export default function OBIPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const obiHistory = useTerminalStore((s) => s.obiHistory);
  const currentOBI = useTerminalStore((s) => s.currentOBI);

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

    if (obiHistory.length < 2) return;

    const data = obiHistory.slice(-Math.floor(W / 2));
    const step = W / data.length;

    // Zero line
    const zeroY = H / 2;
    ctx.strokeStyle = "#2a2a3a";
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(W, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Band lines ±0.5
    for (const band of [-0.5, 0.5]) {
      const y = zeroY - band * (H / 2 - 4);
      ctx.strokeStyle = "#1e1e2a";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Fill area
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = zeroY - data[i].value * (H / 2 - 4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo((data.length - 1) * step, zeroY);
    ctx.closePath();

    const lastValue = data[data.length - 1]?.value ?? 0;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    if (lastValue >= 0) {
      grad.addColorStop(0, "rgba(38,166,154,0.3)");
      grad.addColorStop(0.5, "rgba(38,166,154,0.05)");
      grad.addColorStop(1, "rgba(38,166,154,0)");
    } else {
      grad.addColorStop(0, "rgba(239,83,80,0)");
      grad.addColorStop(0.5, "rgba(239,83,80,0.05)");
      grad.addColorStop(1, "rgba(239,83,80,0.3)");
    }
    ctx.fillStyle = grad;
    ctx.fill();

    // OBI line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = zeroY - data[i].value * (H / 2 - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = lastValue >= 0 ? "#26a69a" : "#ef5350";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = "#4a4a66";
    ctx.font = "8px monospace";
    ctx.textAlign = "right";
    ctx.fillText("1.0", W - 2, 10);
    ctx.fillText("0.0", W - 2, zeroY + 4);
    ctx.fillText("-1.0", W - 2, H - 2);
  }, [obiHistory]);

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
    if (!canvas || obiHistory.length < 2) { hideTooltip(); return; }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const data = obiHistory.slice(-Math.floor(canvas.width / 2));
    const step = canvas.width / data.length;
    const index = Math.min(data.length - 1, Math.floor(x / step));
    const point = data[index];
    if (point) {
      const obi = point.value;
      const direction = obi > 0.2 ? "Bullish (more bid liquidity)" : obi < -0.2 ? "Bearish (more ask liquidity)" : "Neutral";
      showTooltip(
        `OBI: ${obi.toFixed(3)}`,
        `Direction: ${direction}\nTime: ${new Date(point.timestamp).toLocaleTimeString()}\n\nWhat this means: Order Book Imbalance (OBI) measures the ratio of bid vs ask quantity near the top of the book. Values near +1 mean strong buying pressure, near -1 mean strong selling pressure.`,
        e
      );
    } else {
      hideTooltip();
    }
  }, [obiHistory]);

  const obiColor =
    currentOBI > 0.2
      ? "var(--buy)"
      : currentOBI < -0.2
      ? "var(--sell)"
      : "var(--text-secondary)";

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-title">OBI</span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: obiColor,
            fontFamily: "monospace",
          }}
        >
          {currentOBI.toFixed(2)}
        </span>
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
