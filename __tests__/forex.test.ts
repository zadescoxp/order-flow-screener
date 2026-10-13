import { isForexMarketOpen } from "@/lib/adapters/forex";
import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";
import { VENUE_CONFIG } from "@/lib/config/venues";

describe("Forex market support", () => {
  it("keeps the FX market closed between Friday 17:00 and Sunday 17:00 New York time", () => {
    expect(isForexMarketOpen(new Date("2026-01-09T22:00:00.000Z"))).toBe(false);
    expect(isForexMarketOpen(new Date("2026-01-11T21:00:00.000Z"))).toBe(false);
    expect(isForexMarketOpen(new Date("2026-01-11T22:00:00.000Z"))).toBe(true);
  });

  it("supports the configured symbols and all Forex venues", () => {
    expect(venueSupports("massive-forex", "EUR/USD", "forex")).toBe(true);
    expect(venueSupports("finnhub-forex", "BTCUSDT", "forex")).toBe(false);
    expect(venuesForSelection("all-forex", "forex", "GBP/USD")).toEqual([
      "massive-forex",
      "finnhub-forex",
      "mt5-forex",
    ]);
  });

  it("formats Massive subscriptions with the documented C ticker channel", () => {
    expect(VENUE_CONFIG["massive-forex"]?.formatSymbol("EUR/USD")).toBe("EUR-USD");
  });
});
