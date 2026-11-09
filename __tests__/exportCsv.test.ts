import { candlesCsv, csvCell, exportFilename, footprintLevelsCsv, profileCsv, tapeCsv, toCsv } from "@/lib/export/csv";
import { applyTradeToCandle, computeVolumeProfile, createEmptyCandle } from "@/lib/engine/orderFlowEngine";
import type { NormalizedTrade } from "@/lib/types/market";

const t = (id: number, price: number, quantity: number, side: "buy" | "sell", timestamp: number): NormalizedTrade => ({
  id: `t${id}`, venue: "bybit-futures", symbol: "BTCUSDT", timestamp, localTimestamp: timestamp,
  price, quantity, quoteVolume: price * quantity, side, marketType: "perpetual",
});

describe("CSV export", () => {
  it("escapes cells", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["x", "y"], [[1, true]])).toBe("x,y\n1,true\n");
  });

  it("writes candles, levels and the profile", () => {
    let candle = createEmptyCandle(0, "1m");
    candle = applyTradeToCandle(candle, t(1, 100, 2, "buy", 1000), 1, 3);
    candle = applyTradeToCandle(candle, t(2, 101, 1, "sell", 2000), 1, 3);
    const candles = candlesCsv([candle]).trim().split("\n");
    expect(candles[0]).toBe("open_time,open_time_ms,open,high,low,close,volume,buy_volume,sell_volume,delta,cumulative_delta,trades,vwap,complete");
    expect(candles[1].split(",").slice(0, 12)).toEqual(["1970-01-01T00:00:00.000Z", "0", "100", "101", "100", "101", "3", "2", "1", "1", "0", "2"]);

    const levels = footprintLevelsCsv([candle]).trim().split("\n");
    expect(levels).toHaveLength(3);
    expect(levels[1].split(",").slice(2, 6)).toEqual(["100", "0", "2", "2"]);

    const profile = computeVolumeProfile([candle], 0.7);
    const rows = profileCsv(profile).trim().split("\n");
    expect(rows[0]).toContain("in_value_area");
    expect(rows).toHaveLength(3);
  });

  it("writes the tape oldest first", () => {
    const rows = tapeCsv([t(2, 101, 1, "sell", 2000), t(1, 100, 2, "buy", 1000)]).trim().split("\n");
    expect(rows[1]).toContain(",t1");
    expect(rows[2]).toContain(",t2");
  });

  it("builds a UTC filename", () => {
    expect(exportFilename("BTC/USDT", "5m", "candles", "csv", Date.UTC(2026, 10, 9, 14, 5))).toBe("orderflow-BTCUSDT-5m-20261109-1405-candles.csv");
  });
});
