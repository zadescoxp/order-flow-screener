import { EventEmitter } from "events";
import type { Venue } from "@/lib/types/market";

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

// 1m candles. T0 is aligned to a minute boundary.
const T0 = 1_700_000_040_000;
const MIN = 60_000;

let seq = 0;
function print(venue: Venue, timestamp: number, price: number, quantity = 1, side: "buy" | "sell" = "buy") {
  return { id: `${venue}-${seq++}`, venue, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp + 2_500, price, quantity, quoteVolume: price * quantity, side, marketType: "perpetual" as const };
}

function setup() {
  const store = createTerminalStore();
  const manager = new MarketDataManager(store);
  const venues: Venue[] = ["bybit-futures", "htx-futures"];
  manager.subscribe("bybit-futures", "BTCUSDT", "perpetual", "1m", 10, 3, venues);
  return { store, manager, fast: fakes.get("bybit-futures")!, slow: fakes.get("htx-futures")! };
}

const allCandles = (store: ReturnType<typeof createTerminalStore>) => {
  const s = store.getState();
  return s.currentCandle ? [...s.candles, s.currentCandle] : s.candles;
};

describe("late prints from a slower venue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    fakes.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("never reopens a closed candle, so candles stay unique and in order", () => {
    const { store, manager, fast, slow } = setup();
    fast.emit("trade", print("bybit-futures", T0 + 10_000, 100));
    // Boundary: the fast venue opens the next candle, then the slow venue's
    // pre-boundary prints keep arriving, interleaved with new ones.
    for (let i = 0; i < 5; i++) {
      fast.emit("trade", print("bybit-futures", T0 + MIN + i * 400, 101));
      slow.emit("trade", print("htx-futures", T0 + MIN - 2_500 + i * 400, 99, 2, "sell"));
    }
    jest.advanceTimersByTime(100);

    const candles = allCandles(store);
    expect(candles.map((c) => c.openTime)).toEqual([T0, T0 + MIN]);
    manager.disconnect();
  });

  it("folds a late print into the candle it belongs to and keeps CVD consistent", () => {
    const { store, manager, fast, slow } = setup();
    fast.emit("trade", print("bybit-futures", T0 + 10_000, 100, 3, "buy"));
    fast.emit("trade", print("bybit-futures", T0 + MIN + 100, 101, 1, "buy"));
    slow.emit("trade", print("htx-futures", T0 + MIN - 1_000, 99, 2, "sell"));
    jest.advanceTimersByTime(100);

    const [closed, live] = allCandles(store);
    expect(closed.volume).toBe(5);
    expect(closed.delta).toBe(1); // +3 − 2
    expect(closed.cumulativeDelta).toBe(1);
    expect(closed.levels.get(99)?.bidVolume).toBe(2);
    expect(closed.low).toBe(99);
    expect(live.volume).toBe(1);
    expect(live.cumulativeDelta).toBe(2);
    manager.disconnect();
  });

  it("keeps prints older than the previous candle off the footprint but in the session", () => {
    const { store, manager, fast, slow } = setup();
    fast.emit("trade", print("bybit-futures", T0 + 10_000, 100));
    fast.emit("trade", print("bybit-futures", T0 + MIN + 100, 101));
    fast.emit("trade", print("bybit-futures", T0 + 2 * MIN + 100, 102));
    slow.emit("trade", print("htx-futures", T0 + 5_000, 90, 4));
    jest.advanceTimersByTime(100);

    const candles = allCandles(store);
    expect(candles.map((c) => c.openTime)).toEqual([T0, T0 + MIN, T0 + 2 * MIN]);
    expect(candles.reduce((sum, c) => sum + c.volume, 0)).toBe(3);
    expect(store.getState().session?.volume).toBe(7);
    manager.disconnect();
  });
});
