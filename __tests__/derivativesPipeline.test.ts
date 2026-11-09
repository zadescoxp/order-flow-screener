import { EventEmitter } from "events";
import type { Venue } from "@/lib/types/market";

// Fake adapters stand in for the WebSocket feeds so the manager → store
// pipeline can be driven deterministically.
const fakes = new Map<Venue, EventEmitter>();
jest.mock("@/lib/session/adapterPool", () => ({
  acquireAdapter: (venue: Venue) => {
    const adapter = new EventEmitter();
    fakes.set(venue, adapter);
    return adapter;
  },
  releaseAdapter: () => undefined,
}));

import { createTerminalStore } from "@/lib/store/terminalStore";
import { MarketDataManager } from "@/lib/managers/marketDataManager";

function trade(venue: Venue, price: number, timestamp: number) {
  return { id: `${venue}-${timestamp}`, venue, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp, price, quantity: 1, quoteVolume: price, side: "buy", marketType: "perpetual" };
}

describe("derivatives pipeline", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
    fakes.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("delivers liquidations, merged derivatives and sampled open interest to the store", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    const venues: Venue[] = ["bybit-futures", "binance-futures"];
    manager.subscribe("all-perps", "BTCUSDT", "perpetual", "5m", 10, 3, venues);

    const bybit = fakes.get("bybit-futures")!;
    const binance = fakes.get("binance-futures")!;
    const now = Date.now();
    bybit.emit("trade", trade("bybit-futures", 50_000, now));
    bybit.emit("liquidation", { id: "l1", venue: "bybit-futures", symbol: "BTCUSDT", timestamp: now, localTimestamp: now, price: 49_900, quantity: 2, quoteVolume: 99_800, side: "long" });
    bybit.emit("derivatives", { venue: "bybit-futures", timestamp: now, openInterest: 100, fundingRate: 0.0001, markPrice: 50_010, indexPrice: 50_000 });
    bybit.emit("derivatives", { venue: "bybit-futures", timestamp: now + 1, nextFundingTime: now + 3_600_000 });
    jest.advanceTimersByTime(60);

    let state = store.getState();
    expect(state.liquidations).toHaveLength(1);
    expect(state.liquidations[0]).toMatchObject({ side: "long", quoteVolume: 99_800 });
    expect(state.derivatives).toMatchObject({ openInterest: 100, primaryFundingRate: 0.0001, nextFundingTime: now + 3_600_000 });
    expect(state.derivatives!.basisBps).toBeCloseTo(2);

    // OI sampling waits for every selected venue before locking the summed set...
    jest.advanceTimersByTime(2000);
    expect(store.getState().oiHistory).toHaveLength(0);
    binance.emit("derivatives", { venue: "binance-futures", timestamp: now, openInterest: 300 });
    jest.advanceTimersByTime(1100);
    state = store.getState();
    expect(state.oiHistory.length).toBeGreaterThan(0);
    expect(state.oiHistory.at(-1)).toMatchObject({ openInterest: 400, price: 50_000 });
    expect(state.derivatives!.openInterest).toBe(400);

    // ...and ignores data from venues it is no longer subscribed to.
    manager.subscribe("bybit-futures", "BTCUSDT", "perpetual", "5m", 10, 3, ["bybit-futures"]);
    binance.emit("liquidation", { id: "stale", venue: "binance-futures", symbol: "BTCUSDT", timestamp: now, localTimestamp: now, price: 1, quantity: 1, quoteVolume: 1, side: "short" });
    jest.advanceTimersByTime(60);
    expect(store.getState().liquidations).toHaveLength(0);
    manager.disconnect();
  });

  it("drops replayed (stale) and duplicate liquidations", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("okx-futures", "BTCUSDT", "perpetual", "5m", 10, 3, ["okx-futures"]);
    const okx = fakes.get("okx-futures")!;
    const now = Date.now();
    const base = { venue: "okx-futures", symbol: "BTC-USDT-SWAP", localTimestamp: now, price: 100, quantity: 1, quoteVolume: 100, side: "short" };
    okx.emit("liquidation", { ...base, id: "old", timestamp: now - 9 * 3_600_000 });
    okx.emit("liquidation", { ...base, id: "fresh", timestamp: now - 1000 });
    okx.emit("liquidation", { ...base, id: "fresh", timestamp: now - 1000 });
    jest.advanceTimersByTime(60);
    expect(store.getState().liquidations.map((l) => l.id)).toEqual(["fresh"]);
    manager.disconnect();
  });

  it("does not sample open interest for spot markets", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("binance-spot", "BTCUSDT", "spot", "5m", 10, 3, ["binance-spot"]);
    fakes.get("binance-spot")!.emit("trade", { ...trade("binance-spot", 50_000, Date.now()), marketType: "spot" });
    jest.advanceTimersByTime(20_000);
    expect(store.getState().oiHistory).toHaveLength(0);
    manager.disconnect();
  });
});
