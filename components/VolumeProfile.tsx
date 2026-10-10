"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { showTooltip, hideTooltip } from "./GlobalTooltip";

// ─── Volume Profile (Canvas) ─────────────────────────────────────
// Horizontal bar chart showing volume at each price level.
// Synchronized with the main chart crosshair.

export default function VolumeProfilePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const volumeProfile = useTerminalStore((s) => s.volumeProfile);
  const crosshairPrice = useTerminalStore((s) => s.crosshairPrice);
  const theme = useTerminalStore((s) => s.theme);
  const activeTab = React.useRef<"total" | "buy" | "sell" | "delta">("total");
  const [tab, setTab] = React.useState<"total" | "buy" | "sell" | "delta">("total");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Read CSS vars so theme changes are reflected immediately
    const cs = getComputedStyle(document.documentElement);
    const bgPanel   = cs.getPropertyValue("--bg-surface").trim() || "#0f0f12";
    const textMuted  = cs.getPropertyValue("--text-muted").trim()  || "#4a4a66";
    const textSec    = cs.getPropertyValue("--text-secondary").trim() || "#7a7a99";
    const buy        = cs.getPropertyValue("--buy").trim()          || "#26a69a";
    const sell       = cs.getPropertyValue("--sell").trim()         || "#ef5350";
    const highlight  = cs.getPropertyValue("--highlight").trim()    || "#7c6af5";
    const poc        = cs.getPropertyValue("--poc").trim()           || "#f5c842";
    const borderMuted = cs.getPropertyValue("--border-muted").trim() || "#13131a";

    const hex2rgba = (hex: string, a: number) => {
      if (hex.startsWith("rgba") || hex.startsWith("rgb")) return hex;
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    };

    ctx.fillStyle = bgPanel;
    ctx.fillRect(0, 0, W, H);

    if (!volumeProfile || volumeProfile.levels.length === 0) {
      ctx.fillStyle = textMuted;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No data", W / 2, H / 2);
      return;
    }

    const levels = [...volumeProfile.levels].sort((a, b) => b.price - a.price);
    const rowH = Math.max(2, Math.floor(H / levels.length));

    const maxVol = Math.max(
      ...levels.map((l) =>
        tab === "total"
          ? l.totalVolume
          : tab === "buy"
          ? l.askVolume
          : tab === "sell"
          ? l.bidVolume
          : Math.abs(l.delta)
      )
    );

    const BAR_MAX_W = W - 50;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const y = i * rowH;

      if (crosshairPrice !== null && Math.abs(level.price - crosshairPrice) < 5) {
        ctx.fillStyle = hex2rgba(highlight, 0.1);
        ctx.fillRect(0, y, W, rowH);
      }

      if (level.isPOC) {
        ctx.fillStyle = hex2rgba(poc, 0.12);
        ctx.fillRect(0, y, W, rowH);
      } else if (level.isVAH || level.isVAL) {
        ctx.fillStyle = hex2rgba(poc, 0.05);
        ctx.fillRect(0, y, W, rowH);
      }

      let vol = 0;
      let color = textMuted;

      if (tab === "total") {
        const buyW = (level.askVolume / maxVol) * BAR_MAX_W;
        const sellW = (level.bidVolume / maxVol) * BAR_MAX_W;
        ctx.fillStyle = buy;
        ctx.fillRect(0, y + 1, buyW, rowH - 2);
        ctx.fillStyle = sell;
        ctx.fillRect(buyW, y + 1, sellW, rowH - 2);
        vol = level.totalVolume;
        color = textSec;
      } else if (tab === "buy") {
        vol = level.askVolume;
        color = buy;
        ctx.fillStyle = color;
        ctx.fillRect(0, y + 1, (vol / maxVol) * BAR_MAX_W, rowH - 2);
      } else if (tab === "sell") {
        vol = level.bidVolume;
        color = sell;
        ctx.fillStyle = color;
        ctx.fillRect(0, y + 1, (vol / maxVol) * BAR_MAX_W, rowH - 2);
      } else {
        vol = level.delta;
        color = vol >= 0 ? buy : sell;
        ctx.fillStyle = color;
        ctx.fillRect(0, y + 1, (Math.abs(vol) / maxVol) * BAR_MAX_W, rowH - 2);
      }

      if (level.isPOC) {
        ctx.strokeStyle = poc;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + rowH);
        ctx.lineTo(BAR_MAX_W, y + rowH);
        ctx.stroke();
        ctx.fillStyle = poc;
        ctx.font = "7px monospace";
        ctx.textAlign = "left";
        ctx.fillText("POC", BAR_MAX_W + 2, y + rowH - 1);
      }

      if (level.isVAH) {
        ctx.fillStyle = hex2rgba(poc, 0.7);
        ctx.font = "7px monospace";
        ctx.textAlign = "left";
        ctx.fillText("VAH", BAR_MAX_W + 2, y + rowH - 1);
      }
      if (level.isVAL) {
        ctx.fillStyle = hex2rgba(poc, 0.7);
        ctx.font = "7px monospace";
        ctx.textAlign = "left";
        ctx.fillText("VAL", BAR_MAX_W + 2, y + rowH - 1);
      }
    }

    ctx.strokeStyle = borderMuted;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= levels.length; i++) {
      const y = i * rowH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }, [volumeProfile, crosshairPrice, tab, theme]);

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
    if (!canvas || !volumeProfile || volumeProfile.levels.length === 0) {
      hideTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    
    const levels = [...volumeProfile.levels].sort((a, b) => b.price - a.price);
    const rowH = Math.max(2, Math.floor(canvas.height / levels.length));
    const index = Math.floor(y / rowH);
    const level = levels[index];
    
    if (level) {
      const title = `Volume Profile at ${level.price.toLocaleString()}`;
      let extra = "";
      if (level.isPOC) extra = "\n(This is the Point of Control - POC: Highest volume price level)";
      if (level.isVAH) extra = "\n(Value Area High - Top of where 70% of volume occurred)";
      if (level.isVAL) extra = "\n(Value Area Low - Bottom of where 70% of volume occurred)";
      
      const content = `Total Volume: ${level.totalVolume.toFixed(2)}\nBuy Volume: ${level.askVolume.toFixed(2)}\nSell Volume: ${level.bidVolume.toFixed(2)}\nDelta: ${level.delta.toFixed(2)}${extra}\n\nWhat this means: This bar represents the historical accumulation of executed market orders at this price level for the entire session.`;
      
      showTooltip(title, content, e);
    } else {
      hideTooltip();
    }
  }, [volumeProfile]);

  const vp = volumeProfile;

  return (
    <div className="panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header">
        <span className="panel-title">Volume Profile</span>
        <div className="tab-group" style={{ gap: 0 }}>
          {(["total", "buy", "sell", "delta"] as const).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? "active" : ""}`}
              onClick={() => { setTab(t); activeTab.current = t; }}
              style={{ padding: "1px 5px", fontSize: 9 }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
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

      {/* Stats footer */}
      {vp && (
        <div
          style={{
            padding: "4px 8px",
            borderTop: "1px solid var(--border-muted)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "2px 8px",
            fontSize: 9.5,
            flexShrink: 0,
          }}
        >
          <div style={{ color: "var(--text-muted)" }}>
            POC <span style={{ color: "var(--poc)" }}>{vp.poc.toLocaleString()}</span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            VAH <span style={{ color: "var(--text-secondary)" }}>{vp.vah.toLocaleString()}</span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            VAL <span style={{ color: "var(--text-secondary)" }}>{vp.val.toLocaleString()}</span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            Total <span style={{ color: "var(--text-secondary)" }}>{(() => { const v = vp.totalVolume; return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); })()}</span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            Buy{" "}
            <span style={{ color: "var(--buy)" }}>
              {(() => { const v = vp.buyVolume; return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); })()}
            </span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            Sell{" "}
            <span style={{ color: "var(--sell)" }}>
              {(() => { const v = vp.sellVolume; return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); })()}
            </span>
          </div>
          <div
            style={{
              gridColumn: "1 / -1",
              color: "var(--text-muted)",
            }}
          >
            Delta{" "}
            <span style={{ color: vp.delta >= 0 ? "var(--buy)" : "var(--sell)" }}>
              {vp.delta >= 0 ? "+" : ""}{(() => { const v = Math.abs(vp.delta); return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0); })()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
