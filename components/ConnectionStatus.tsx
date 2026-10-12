"use client";

import React from "react";
import { useSessionStore } from "@/lib/session/SessionContext";
import type { VenueConnection } from "@/lib/types/market";

// ─── Connection Status Bar ────────────────────────────────────────
// Shows per-venue connection state in the terminal.

const VENUE_LABELS: Record<string, string> = {
  "binance-futures": "Binance Perp",
  "binance-spot": "Binance Spot",
  "bybit-futures": "Bybit Perp",
  "bybit-spot": "Bybit Spot",
  "okx-futures": "OKX Perp",
  "okx-spot": "OKX Spot",
  "bitget-futures": "Bitget Perp",
  "bitget-spot": "Bitget Spot",
  "hyperliquid": "Hyperliquid",
  "deribit": "Deribit",
  "coinbase-spot": "Coinbase",
};

function ConnectionDot({ status }: { status: VenueConnection["status"] }) {
  return (
    <span className={`status-dot ${status}`} style={{ display: "inline-block" }} />
  );
}

export default function ConnectionStatusBar() {
  const connections = useSessionStore((s) => s.connections);
  const entries = Object.values(connections);
  const selectedVenues = useSessionStore((s) => s.selectedVenues);

  if (entries.length === 0 && selectedVenues.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 9.5,
        color: "var(--text-muted)",
      }}
    >
      {entries.map((conn) => (
        <div
          key={conn.venue}
          style={{ display: "flex", alignItems: "center", gap: 4 }}
          title={`${conn.venue}: ${conn.status}${
            conn.latencyMs ? ` (${conn.latencyMs}ms)` : ""
          }${conn.error ? ` — ${conn.error}` : ""}`}
        >
          <ConnectionDot status={conn.status} />
          <span style={{ color: conn.status === "live" ? "var(--text-secondary)" : "var(--text-muted)" }}>
            {VENUE_LABELS[conn.venue] ?? conn.venue}
          </span>
          <span
            style={{
              color:
                conn.status === "live"
                  ? "var(--buy)"
                  : conn.status === "stale"
                  ? "#ff8800"
                  : "var(--text-muted)",
              fontSize: 8.5,
              fontWeight: 600,
            }}
          >
            {conn.status.toUpperCase()}
          </span>
        </div>
      ))}
      {selectedVenues.length > 1 && (
        <strong style={{ color: "var(--text-secondary)" }}>
          {selectedVenues.filter((venue) => connections[venue]?.status === "live").length}/{selectedVenues.length} live
        </strong>
      )}
    </div>
  );
}
