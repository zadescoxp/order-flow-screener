import { venueForMarket } from "@/lib/adapters/capabilities";
import { createTerminalStore } from "@/lib/store/terminalStore";

describe("perp ↔ spot switch", () => {
  it("finds the same exchange in the other market, if it has one", () => {
    expect(venueForMarket("bybit-futures", "spot")).toBe("bybit-spot");
    expect(venueForMarket("kraken-spot", "perpetual")).toBe("kraken-futures");
    expect(venueForMarket("hyperliquid", "spot")).toBeUndefined();
    expect(venueForMarket("deribit", "spot")).toBeUndefined();
    expect(venueForMarket("coinbase-spot", "perpetual")).toBeUndefined();
  });

  it("keeps the exchange when switching markets", () => {
    const store = createTerminalStore();
    store.getState().setVenue("okx-futures");
    store.getState().setMarketType("spot");
    expect(store.getState()).toMatchObject({ marketType: "spot", venue: "okx-spot", selectedVenues: ["okx-spot"] });
    store.getState().setMarketType("perpetual");
    expect(store.getState()).toMatchObject({ venue: "okx-futures", selectedVenues: ["okx-futures"] });
  });

  it("maps All perps to All spot with the venues that list the coin", () => {
    const store = createTerminalStore();
    store.getState().setSymbol("BTCUSDT");
    store.getState().setVenue("all-perps");
    store.getState().setMarketType("spot");
    const { venue, selectedVenues } = store.getState();
    expect(venue).toBe("all-spot");
    expect(selectedVenues).toEqual(expect.arrayContaining(["binance-spot", "coinbase-spot", "bybit-spot"]));
    expect(selectedVenues.every((v) => !v.endsWith("-futures") && v !== "hyperliquid")).toBe(true);
  });
});
