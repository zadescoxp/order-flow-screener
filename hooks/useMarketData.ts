"use client";

import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store/terminalStore";
import { marketDataManager } from "@/lib/managers/marketDataManager";

// ─── Hook: useMarketData ─────────────────────────────────────────
// Subscribes to live exchange data whenever symbol/venue/timeframe changes.
// Handles cleanup on unmount or setting change.

export function useMarketData() {
  const symbol = useTerminalStore((s) => s.symbol);
  const venue = useTerminalStore((s) => s.venue);
  const marketType = useTerminalStore((s) => s.marketType);
  const timeframe = useTerminalStore((s) => s.timeframe);
  const tickSize = useTerminalStore((s) => s.tickSize);
  const imbalanceThreshold = useTerminalStore((s) => s.imbalanceThreshold);

  useEffect(() => {
    marketDataManager.subscribe(
      venue,
      symbol,
      marketType,
      timeframe,
      tickSize,
      imbalanceThreshold
    );

    return () => {
      // Don't disconnect on every re-render; manager handles de-duplication
    };
  }, [symbol, venue, marketType, timeframe, tickSize, imbalanceThreshold]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      marketDataManager.disconnect();
    };
  }, []);
}
