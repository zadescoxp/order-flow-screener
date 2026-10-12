"use client";

import { useEffect, useRef } from "react";
import { useMarketSession, useSessionStore } from "@/lib/session/SessionContext";

// ─── Hook: useMarketData ─────────────────────────────────────────
// Subscribes to live exchange data whenever symbol/venue/timeframe changes.
// Handles cleanup on unmount or setting change.

export function useMarketData() {
  const symbol = useSessionStore((s) => s.symbol);
  const venue = useSessionStore((s) => s.venue);
  const marketType = useSessionStore((s) => s.marketType);
  const timeframe = useSessionStore((s) => s.timeframe);
  const tickSize = useSessionStore((s) => s.tickSize);
  const imbalanceThreshold = useSessionStore((s) => s.imbalanceThreshold);
  const session = useMarketSession();

  useEffect(() => {
    session.manager.subscribe(
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
  }, [session, symbol, venue, marketType, timeframe, tickSize, imbalanceThreshold]);
}
