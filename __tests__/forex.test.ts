import { isForexMarketOpen } from "@/lib/adapters/forex";
import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";

describe("Forex market support", () => {
  it("keeps the FX market closed between Friday 17:00 and Sunday 17:00 New York time", () => {
    expect(isForexMarketOpen(new Date("2026-01-09T22:00:00.000Z"))).toBe(false);
    expect(isForexMarketOpen(new Date("2026-01-11T21:00:00.000Z"))).toBe(false);
    expect(isForexMarketOpen(new Date("2026-01-11T22:00:00.000Z"))).toBe(true);
  });

  it("supports currency pairs through the internal Finnhub source only", () => {
    expect(venueSupports("finnhub-forex", "EUR/USD", "forex")).toBe(true);
    expect(venueSupports("finnhub-forex", "BTCUSDT", "forex")).toBe(false);
    expect(venuesForSelection("finnhub-forex", "forex", "GBP/USD")).toEqual(["finnhub-forex"]);
  });
});
