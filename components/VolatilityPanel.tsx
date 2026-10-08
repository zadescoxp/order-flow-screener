"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Volatility / Z-Score Panel (Canvas) ────────────────────────
// Rolling Z-score of trade volume, with Volume Heatmap option.

type ZTab = "zscore" | "heatmap";

const Z_WINDOWS = [20, 50, 100, 200] as const;
type ZWindow = (typeof Z_WINDOWS)[number];

const Z_LEVELS = [
  { value: 3, color: "rgba(255,68,68,0.8)", label: "+3" },
  { value: 2, color: "rgba(255,136,0,0.7)", label: "+2" },
  { value: 1, color: "rgba(255,204,0,0.6)", label: "+1" },
  { value: 0, color: "rgba(100,100,140,0.3)", label: "0" },
  { value: -1, color: "rgba(255,204,0,0.6)", label: "-1" },
  { value: -2, color: "rgba(255,136,0,0.7)", label: "-2" },
  { value: -3, color: "rgba(255,68,68,0.8)", label: "-3" },
];

function zScoreColor(z: number): string {
  const absZ = Math.abs(z);
  if (absZ >= 3) return z >= 0 ? "#ff4444" : "#ff4444";
  if (absZ >= 2) return "#ff8800";
  if (absZ >= 1) return "#ffcc00";
  return "#5c5c80";
}

export default function VolatilityPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zScoreHistory = useTerminalStore((s) => s.zScoreHistory);
  const crosshairTime = useTerminalStore((s) => s.crosshairTime);
  const [tab, setTab] = useState<ZTab>("zscore");
  const [window, setWindow] = useState<ZWindow>(20);

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

    if (zScoreHistory.length < 2) {
      ctx.fillStyle = "#4a4a66";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for trade data…", W / 2, H / 2);
      return;
    }

    const data = zScoreHistory.slice(-Math.floor(W));
    const step = W / data.length;
    const zeroY = H / 2;
    const yScale = (H / 2 - 10) / 3;

    if (tab === "zscore") {
      // Horizontal grid lines
      for (const level of Z_LEVELS) {
        const y = zeroY - level.value * yScale;
        if (y < 0 || y > H) continue;
        ctx.strokeStyle = Math.abs(level.value) >= 2 ? "#2a2a3a" : "#161620";
        ctx.lineWidth = Math.abs(level.value) === 3 ? 0.8 : 0.5;
        ctx.setLineDash(level.value !== 0 ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.fillStyle = "#3a3a55";
        ctx.font = "8px monospace";
        ctx.textAlign = "left";
        ctx.fillText(level.label, 2, y - 1);
      }

      // Fill area
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = zeroY - data[i].value * yScale;
        ctx.lineTo(x, Math.max(0, Math.min(H, y)));
      }
      ctx.lineTo((data.length - 1) * step, zeroY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(124,106,245,0.2)");
      grad.addColorStop(0.5, "rgba(124,106,245,0.05)");
      grad.addColorStop(1, "rgba(124,106,245,0.0)");
      ctx.fillStyle = grad;
      ctx.fill();

      // Z-score line (color-coded)
      for (let i = 1; i < data.length; i++) {
        const x0 = (i - 1) * step;
        const x1 = i * step;
        const y0 = zeroY - data[i - 1].value * yScale;
        const y1 = zeroY - data[i].value * yScale;
        ctx.beginPath();
        ctx.moveTo(x0, Math.max(0, Math.min(H, y0)));
        ctx.lineTo(x1, Math.max(0, Math.min(H, y1)));
        ctx.strokeStyle = zScoreColor(data[i].value);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      // Volume Heatmap
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const z = data[i].value;
        const intensity = Math.min(1, Math.abs(z) / 3);
        const r = z >= 0 ? 38 : 239;
        const g = z >= 0 ? 166 : 83;
        const b = z >= 0 ? 154 : 80;
        ctx.fillStyle = `rgba(${r},${g},${b},${intensity * 0.8})`;
        ctx.fillRect(x, 0, step + 1, H);
      }
    }

    // Crosshair sync
    if (crosshairTime !== null && data.length > 0) {
      const first = data[0].timestamp;
      const last = data[data.length - 1].timestamp;
      const range = last - first;
      if (range > 0) {
        const cx = ((crosshairTime - first) / range) * W;
        if (cx >= 0 && cx <= W) {
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, H);
          ctx.stroke();
        }
      }
    }
  }, [zScoreHistory, tab, crosshairTime]);

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
    if (!canvas || zScoreHistory.length < 2) { hideTooltip(); return; }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const data = zScoreHistory.slice(-Math.floor(canvas.width));
    const step = canvas.width / data.length;
    const index = Math.min(data.length - 1, Math.floor(x / step));
    const point = data[index];
    if (point) {
      const z = point.value;
      const absZ = Math.abs(z);
      let intensity = "Normal";
      if (absZ >= 3) intensity = "🚨 Extreme spike — very unusual volume";
      else if (absZ >= 2) intensity = "⚠️ High — elevated volume spike";
      else if (absZ >= 1) intensity = "📈 Elevated — above average volume";
      else intensity = "Normal — average volume range";
      showTooltip(
        `Z-Score: ${z >= 0 ? "+" : ""}${z.toFixed(2)}`,
        `Intensity: ${intensity}\nTime: ${new Date(point.timestamp).toLocaleTimeString()}\n\nWhat this means: The Z-Score compares current trade volume against the rolling average. A Z-Score above +2 or below -2 signals an unusual volume spike — often a sign of institutional activity or news-driven momentum.`,
        e
      );
    } else {
      hideTooltip();
    }
  }, [zScoreHistory]);

  const lastZ = zScoreHistory[zScoreHistory.length - 1]?.value ?? 0;

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-title">Volatility / Z-Score</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Window selector */}
          <div className="tab-group" style={{ gap: 0 }}>
            {Z_WINDOWS.map((w) => (
              <button
                key={w}
                className={`tab ${window === w ? "active" : ""}`}
                onClick={() => setWindow(w)}
                style={{ padding: "1px 5px", fontSize: 9 }}
              >
                {w}
              </button>
            ))}
          </div>
          <div className="topbar-sep" style={{ margin: 0 }} />
          {/* Tab selector */}
          <div className="tab-group" style={{ gap: 0 }}>
            <button
              className={`tab ${tab === "zscore" ? "active" : ""}`}
              onClick={() => setTab("zscore")}
              style={{ padding: "1px 6px", fontSize: 9 }}
            >
              Z-Score
            </button>
            <button
              className={`tab ${tab === "heatmap" ? "active" : ""}`}
              onClick={() => setTab("heatmap")}
              style={{ padding: "1px 6px", fontSize: 9 }}
            >
              Volume Heatmap
            </button>
          </div>
          {/* Current Z value */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: zScoreColor(lastZ),
              marginLeft: 4,
              fontFamily: "monospace",
            }}
          >
            {lastZ >= 0 ? "+" : ""}{lastZ.toFixed(2)}
          </span>
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
