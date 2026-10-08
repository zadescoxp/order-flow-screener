"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import type { NormalizedOrderBook } from "@/lib/types/market";

// ─── Order Book Panel ────────────────────────────────────────────
// Shows live bid/ask levels with cumulative size bars.
// Supports: single venue, aggregated, compact modes.

function formatSize(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}K`;
  return v.toFixed(4);
}

function formatPrice(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

const MAX_LEVELS = 20;

export default function OrderBookPanel() {
  const orderBook = useTerminalStore((s) => s.orderBook);
  const orderBookMode = useTerminalStore((s) => s.orderBookMode);
  const setOrderBookMode = useTerminalStore((s) => s.setOrderBookMode);
  const ticker = useTerminalStore((s) => s.ticker);

  const displayBook = orderBookMode === "aggregated" && useTerminalStore.getState().aggregatedBook 
    ? useTerminalStore.getState().aggregatedBook 
    : orderBook;

  if (!displayBook) {
    return (
      <div className="panel" style={{ height: "100%" }}>
        <div className="panel-header">
          <span className="panel-title">Order Book</span>
          <ModeSelector mode={orderBookMode} setMode={setOrderBookMode} />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 10 }}>
          Waiting for {orderBookMode} order book…
        </div>
      </div>
    );
  }

  // Grouping logic for Compact mode
  const tickSize = useTerminalStore.getState().tickSize;
  const groupFactor = orderBookMode === "compact" ? 10 : (orderBookMode === "aggregated" ? 5 : 1);
  const effectiveTickSize = tickSize * groupFactor;

  const groupLevels = (levels: {price: number, size: number}[], isAsk: boolean) => {
    if (groupFactor === 1) return levels.slice(0, MAX_LEVELS);
    const map = new Map<number, number>();
    for (const l of levels) {
      // For asks, we round up to the nearest effective tick. For bids, round down.
      const rounded = isAsk 
        ? Math.ceil(l.price / effectiveTickSize) * effectiveTickSize
        : Math.floor(l.price / effectiveTickSize) * effectiveTickSize;
      map.set(rounded, (map.get(rounded) || 0) + l.size);
    }
    const grouped = Array.from(map.entries()).map(([price, size]) => ({ price, size }));
    if (isAsk) {
      grouped.sort((a, b) => a.price - b.price);
    } else {
      grouped.sort((a, b) => b.price - a.price);
    }
    return grouped.slice(0, MAX_LEVELS);
  };

  const asks = groupLevels(displayBook.asks, true);
  const bids = groupLevels(displayBook.bids, false);

  // Cumulative sizes
  let cumAsk = 0;
  const asksWithCum = [...asks].reverse().map((a) => {
    cumAsk += a.size;
    return { ...a, cum: cumAsk };
  });
  asksWithCum.reverse();
  const maxCumAsk = cumAsk;

  let cumBid = 0;
  const bidsWithCum = bids.map((b) => {
    cumBid += b.size;
    return { ...b, cum: cumBid };
  });
  const maxCumBid = cumBid;

  const midPrice = ticker?.price ?? displayBook.asks[0]?.price ?? 0;
  const topAsk = displayBook.asks[0]?.price ?? 0;
  const topBid = displayBook.bids[0]?.price ?? 0;
  const spread = topAsk - topBid;
  const spreadPct = topBid > 0 ? (spread / topBid) * 100 : 0;

  return (
    <div
      className="panel"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <div className="panel-header">
        <span className="panel-title">Order Book</span>
        <ModeSelector mode={orderBookMode} setMode={setOrderBookMode} />
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "2px 8px",
          fontSize: 9.5,
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-muted)",
          flexShrink: 0,
        }}
      >
        <span>Price</span>
        <span style={{ textAlign: "right" }}>Size</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>

      {/* Asks (reversed so highest ask is at top of list) */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div>
          {asksWithCum.map((ask) => (
            <div className="ob-row" key={ask.price} style={{ position: "relative" }}>
              {/* Depth bar */}
              <div
                className="ob-depth-bar ask"
                style={{ width: `${(ask.cum / maxCumAsk) * 100}%`, opacity: 0.12 }}
              />
              <span style={{ color: "var(--sell)", fontWeight: 500 }}>
                {formatPrice(ask.price)}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                {formatSize(ask.size)}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-muted)" }}>
                {formatSize(ask.cum)}
              </span>
            </div>
          ))}
        </div>

        {/* Mid price / spread */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "3px 8px",
            background: "var(--bg-active)",
            borderTop: "1px solid var(--border-muted)",
            borderBottom: "1px solid var(--border-muted)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
            {midPrice.toLocaleString("en-US", { minimumFractionDigits: 1 })}
          </span>
          <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
            Spread {spread.toFixed(1)} ({spreadPct.toFixed(3)}%)
          </span>
        </div>

        {/* Bids */}
        <div>
          {bidsWithCum.map((bid) => (
            <div className="ob-row" key={bid.price} style={{ position: "relative" }}>
              {/* Depth bar */}
              <div
                className="ob-depth-bar bid"
                style={{ width: `${(bid.cum / maxCumBid) * 100}%`, opacity: 0.12 }}
              />
              <span style={{ color: "var(--buy)", fontWeight: 500 }}>
                {formatPrice(bid.price)}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                {formatSize(bid.size)}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-muted)" }}>
                {formatSize(bid.cum)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModeSelector({
  mode,
  setMode,
}: {
  mode: "single" | "aggregated" | "compact";
  setMode: (m: "single" | "aggregated" | "compact") => void;
}) {
  const modes: Array<{ value: "single" | "aggregated" | "compact"; label: string }> = [
    { value: "single", label: "Single" },
    { value: "aggregated", label: "Aggregated" },
    { value: "compact", label: "Compact" },
  ];
  return (
    <div className="tab-group" style={{ gap: 0 }}>
      {modes.map((m) => (
        <button
          key={m.value}
          className={`tab ${mode === m.value ? "active" : ""}`}
          onClick={() => setMode(m.value)}
          style={{ padding: "1px 5px", fontSize: 9 }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
