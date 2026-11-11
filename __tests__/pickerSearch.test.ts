import { matchesSearch } from "@/components/ui/Picker";

describe("picker search", () => {
  const gold = "XAU/USD Gold · perpetual order flow XAU Gold XAUUSD XAUUSDT XAUSD";
  const goldPerp = "XAU/USDT Gold XAU Gold XAUUSD XAUSD";

  it.each(["xau", "XAUUSD", "xausd", "xau/usd", "xau usd", "XAU-USD", "gold", "xauusdt"])("finds gold for %s", (q) => {
    expect(matchesSearch(q, gold)).toBe(true);
    expect(matchesSearch(q, goldPerp)).toBe(true);
  });

  it("ignores separators for FX pairs", () => {
    for (const q of ["eurusd", "EUR/USD", "eur usd", "eur-usd"]) expect(matchesSearch(q, "EUR/USD Major")).toBe(true);
    expect(matchesSearch("gbpusd", "EUR/USD Major")).toBe(false);
  });

  it("requires every word to match", () => {
    expect(matchesSearch("bitcoin btc", "BTCUSDT Bitcoin BTC")).toBe(true);
    expect(matchesSearch("bitcoin eth", "BTCUSDT Bitcoin BTC")).toBe(false);
  });
});
