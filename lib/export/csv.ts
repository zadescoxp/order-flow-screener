// ============================================================
// CSV EXPORT
// Pure builders for the session's data. Times are written both as ISO
// (UTC) and epoch milliseconds; rows are oldest first.
// ============================================================

import type {
  FootprintCandle,
  NormalizedLiquidation,
  NormalizedTrade,
  OpenInterestPoint,
  VolumeProfile,
} from "@/lib/types/market";

type Cell = string | number | boolean | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  // 15 significant digits drops float noise (8.247999999999964 → 8.248) and keeps ms timestamps exact.
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

const iso = (ms: number) => new Date(ms).toISOString();

export function candlesCsv(candles: FootprintCandle[]): string {
  return toCsv(
    ["open_time", "open_time_ms", "open", "high", "low", "close", "volume", "buy_volume", "sell_volume", "delta", "cumulative_delta", "trades", "vwap", "complete"],
    candles.map((c) => {
      let buy = 0;
      let sell = 0;
      for (const level of c.levels.values()) {
        buy += level.askVolume;
        sell += level.bidVolume;
      }
      return [iso(c.openTime), c.openTime, c.open, c.high, c.low, c.close, c.volume, buy, sell, c.delta, c.cumulativeDelta, c.tradeCount, c.vwap, c.complete];
    })
  );
}

/** One row per traded price level per candle. bid = sells hitting the bid, ask = buys lifting the offer. */
export function footprintLevelsCsv(candles: FootprintCandle[]): string {
  const rows: Cell[][] = [];
  for (const c of candles) {
    for (const price of c.sortedPrices) {
      const l = c.levels.get(price);
      if (!l) continue;
      rows.push([iso(c.openTime), c.openTime, price, l.bidVolume, l.askVolume, l.totalVolume, l.delta, l.tradeCount, l.buyTrades, l.sellTrades, l.maxTradeSize]);
    }
  }
  return toCsv(
    ["open_time", "open_time_ms", "price", "bid_volume", "ask_volume", "total_volume", "delta", "trades", "buy_trades", "sell_trades", "max_trade"],
    rows
  );
}

export function profileCsv(profile: VolumeProfile): string {
  const levels = [...profile.levels].sort((a, b) => a.price - b.price);
  return toCsv(
    ["price", "total_volume", "buy_volume", "sell_volume", "delta", "trades", "poc", "vah", "val", "in_value_area"],
    levels.map((l) => [l.price, l.totalVolume, l.askVolume, l.bidVolume, l.delta, l.tradeCount, l.isPOC, l.isVAH, l.isVAL, l.price >= profile.val && l.price <= profile.vah])
  );
}

/** Accepts trades in any order; writes them oldest first. */
export function tapeCsv(trades: NormalizedTrade[]): string {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  return toCsv(
    ["time", "time_ms", "venue", "symbol", "side", "price", "quantity", "quote_volume", "id"],
    sorted.map((t) => [iso(t.timestamp), t.timestamp, t.venue, t.symbol, t.side, t.price, t.quantity, t.quoteVolume, t.id])
  );
}

export function liquidationsCsv(liquidations: NormalizedLiquidation[]): string {
  const sorted = [...liquidations].sort((a, b) => a.timestamp - b.timestamp);
  return toCsv(
    ["time", "time_ms", "venue", "symbol", "position", "price", "quantity", "quote_volume"],
    sorted.map((l) => [iso(l.timestamp), l.timestamp, l.venue, l.symbol, l.side, l.price, l.quantity, l.quoteVolume])
  );
}

export function openInterestCsv(points: OpenInterestPoint[]): string {
  return toCsv(
    ["time", "time_ms", "open_interest", "price", "open_interest_value"],
    points.map((p) => [iso(p.time), p.time, p.openInterest, p.price, p.openInterest * p.price])
  );
}

/** `orderflow-BTCUSDT-5m-20261109-1405-candles.csv` (UTC). */
export function exportFilename(symbol: string, timeframe: string, kind: string, ext: string, at = Date.now()): string {
  const stamp = new Date(at).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `orderflow-${symbol.replace(/[^A-Za-z0-9]/g, "")}-${timeframe}-${stamp}-${kind}.${ext}`;
}
