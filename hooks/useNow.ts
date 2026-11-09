"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock milliseconds, refreshed every `intervalMs` (for countdowns and
 * rolling windows). Returns 0 until mounted: reading the clock during render
 * would be frozen into the prerendered page.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
