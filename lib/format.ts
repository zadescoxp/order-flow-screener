// Shared number / time formatting for panels and canvas renderers.

import { getTickDecimals } from "@/lib/engine/orderFlowEngine";

export function formatCompact(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`;
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`;
  if (abs >= 1) return `${sign}${abs.toFixed(abs >= 10 ? 1 : 2)}`;
  if (abs === 0) return "0";
  return `${sign}${abs.toFixed(abs >= 0.01 ? 3 : 4)}`;
}

export function formatSigned(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${formatCompact(value, digits)}`;
}

export function formatPercent(value: number, digits = 2, signed = true): string {
  if (!Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function priceDecimals(tickSize: number, price?: number): number {
  const fromTick = getTickDecimals(tickSize);
  if (price === undefined) return fromTick;
  // Show at least enough precision for low-priced instruments.
  const minimum = price < 1 ? 5 : price < 10 ? 4 : price < 100 ? 3 : price < 1000 ? 2 : 1;
  return Math.max(fromTick, Math.min(minimum, fromTick + 2));
}

/** Decimals needed to show a set of raw exchange prices without collapsing levels. */
export function inferDecimals(prices: number[], max = 8): number {
  let decimals = 0;
  for (const price of prices) {
    if (!Number.isFinite(price)) continue;
    while (decimals < max) {
      const scaled = price * 10 ** decimals;
      if (Math.abs(scaled - Math.round(scaled)) < 1e-6) break;
      decimals++;
    }
  }
  return decimals;
}

export function formatPriceValue(price: number, decimals: number): string {
  if (!Number.isFinite(price)) return "—";
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatClock(timestamp: number, withMs = false): string {
  const d = new Date(timestamp);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  if (!withMs) return `${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}.${d.getMilliseconds().toString().padStart(3, "0")}`;
}

export function formatHM(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

export const VENUE_SHORT: Record<string, string> = {
  "binance-futures": "BIN",
  "binance-spot": "BIN",
  "bybit-futures": "BYB",
  "bybit-spot": "BYB",
  "okx-futures": "OKX",
  "okx-spot": "OKX",
  "bitget-futures": "BGT",
  "bitget-spot": "BGT",
  hyperliquid: "HYP",
  deribit: "DRB",
  "coinbase-spot": "CB",
  "finnhub-forex": "FX",
};

export const VENUE_LABEL: Record<string, string> = {
  "binance-futures": "Binance Perp",
  "binance-spot": "Binance Spot",
  "bybit-futures": "Bybit Perp",
  "bybit-spot": "Bybit Spot",
  "okx-futures": "OKX Perp",
  "okx-spot": "OKX Spot",
  "bitget-futures": "Bitget Perp",
  "bitget-spot": "Bitget Spot",
  hyperliquid: "Hyperliquid",
  deribit: "Deribit",
  "coinbase-spot": "Coinbase",
  "finnhub-forex": "FX Feed",
  "all-perps": "All Perps",
  "all-spot": "All Spot",
};
