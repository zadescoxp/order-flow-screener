// Footprint imbalance rules, evaluated at render / alert time so the ratio
// and minimum stack size can change without recomputing candles.

import type { FootprintCandle, FootprintLevel } from "@/lib/types/market";

/** Horizontal imbalance at a level for the chosen ratio (engine rule, evaluated at render time). */
export function imbalanceOf(level: FootprintLevel, ratio: number): "buy" | "sell" | null {
  if (level.bidVolume > 0 && level.askVolume / level.bidVolume >= ratio) return "buy";
  if (level.askVolume > 0 && level.bidVolume / level.askVolume >= ratio) return "sell";
  return null;
}

/** Runs of ≥ minLevels consecutive traded levels imbalanced in the same direction. */
export function stackedRuns(candle: FootprintCandle, ratio: number, minLevels: number) {
  const out: { dir: "buy" | "sell"; start: number; end: number }[] = [];
  const prices = candle.sortedPrices;
  let dir: "buy" | "sell" | null = null;
  let startIndex = 0;
  const flush = (endIndex: number) => {
    if (dir && endIndex - startIndex + 1 >= minLevels) out.push({ dir, start: prices[startIndex], end: prices[endIndex] });
  };
  for (let i = 0; i < prices.length; i++) {
    const level = candle.levels.get(prices[i]);
    const d = level ? imbalanceOf(level, ratio) : null;
    if (d !== dir) {
      flush(i - 1);
      dir = d;
      startIndex = i;
    }
  }
  flush(prices.length - 1);
  return out;
}
