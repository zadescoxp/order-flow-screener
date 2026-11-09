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
import { SessionRecorder } from "@/lib/recording/recorder";
import { ReplayPlayer } from "@/lib/recording/player";
import { MemoryRecordingStorage } from "@/lib/recording/storage";
import type { RecordingStatus, ReplayStatus } from "@/lib/recording/types";

const T0 = 1_700_000_000_000;

function trade(i: number, price: number, quantity = 1, side: "buy" | "sell" = "buy") {
  const timestamp = T0 + i * 100;
  return { id: `bb-${i}`, venue: "bybit-futures" as const, symbol: "BTCUSDT", timestamp, localTimestamp: timestamp, price, quantity, quoteVolume: price * quantity, side, marketType: "perpetual" as const };
}

async function flushPromises() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("big trades", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    fakes.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("captures prints ≥ 5× the average after warm-up, and logs the tape for export", () => {
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("bybit-futures", "BTCUSDT", "perpetual", "1m", 10, 3, ["bybit-futures"]);
    const bybit = fakes.get("bybit-futures")!;
    for (let i = 0; i < 60; i++) bybit.emit("trade", trade(i, 50_000));
    bybit.emit("trade", trade(60, 50_000, 40, "sell"));
    jest.advanceTimersByTime(60);
    const big = store.getState().bigTrades;
    expect(big).toHaveLength(1);
    expect(big[0]).toMatchObject({ side: "sell", quantity: 40 });
    expect(big[0].ratio).toBeGreaterThan(20);
    expect(manager.tapeLogSize).toBe(61);
    expect(manager.getTapeLog()[0].id).toBe("bb-60");
    manager.disconnect();
  });
});

describe("recording and replay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    fakes.clear();
  });
  afterEach(() => jest.useRealTimers());

  it("records the live stream and replays it into an identical footprint", async () => {
    const storage = new MemoryRecordingStorage();
    const liveStore = createTerminalStore();
    const live = new MarketDataManager(liveStore);
    live.subscribe("bybit-futures", "BTCUSDT", "perpetual", "1m", 10, 3, ["bybit-futures"]);
    const bybit = fakes.get("bybit-futures")!;

    const statuses: (RecordingStatus | null)[] = [];
    const recorder = new SessionRecorder({
      storage,
      meta: { id: "rec-1", symbol: "BTCUSDT", venue: "bybit-futures", selectedVenues: ["bybit-futures"], marketType: "perpetual", timeframe: "1m", imbalanceThreshold: 3, startedAt: T0 },
      onStatus: (s) => statuses.push(s),
    });
    await recorder.start();
    live.setRecorder(recorder);

    // 30 s of trades, books (throttled to 2/s) and a liquidation.
    for (let i = 0; i < 300; i++) {
      jest.setSystemTime(T0 + i * 100);
      bybit.emit("trade", trade(i, 50_000 + (i % 7) * 10, 1 + (i % 3), i % 2 ? "buy" : "sell"));
      bybit.emit("orderbook", { venue: "bybit-futures", symbol: "BTCUSDT", timestamp: T0 + i * 100, localTimestamp: T0 + i * 100, bids: [{ price: 49_990, size: 1 }], asks: [{ price: 50_010, size: 1 }] });
      if (i === 150) bybit.emit("liquidation", { id: "liq-1", venue: "bybit-futures", symbol: "BTCUSDT", timestamp: T0 + i * 100, localTimestamp: T0 + i * 100, price: 50_000, quantity: 2, quoteVolume: 100_000, side: "long" });
    }
    jest.advanceTimersByTime(60);
    const meta = await recorder.stop();
    live.setRecorder(null);
    await flushPromises();

    expect(meta.complete).toBe(true);
    // 300 trades + 1 liquidation + ~60 throttled books
    expect(meta.events).toBeGreaterThan(300);
    expect(meta.events).toBeLessThan(380);
    expect(statuses.at(-1)).toBeNull();
    const liveCandles = [...liveStore.getState().candles, liveStore.getState().currentCandle!];

    // Replay into a fresh store at 20× on a manual clock.
    const replayStore = createTerminalStore();
    const replay = new MarketDataManager(replayStore);
    let wall = 0;
    const queue: (() => void)[] = [];
    const replayStatuses: ReplayStatus[] = [];
    const player = new ReplayPlayer({
      storage,
      manager: replay,
      meta: (await storage.getMeta("rec-1"))!,
      onStatus: (s) => replayStatuses.push(s),
      schedule: (fn) => queue.push(fn),
      cancel: () => undefined,
      wallNow: () => wall,
    });
    await player.load();
    player.setSpeed(20);
    player.play();
    // Ignored while replaying: the live feed must stay disconnected.
    replay.subscribe("bybit-futures", "ETHUSDT", "perpetual", "1m", 10, 3, ["bybit-futures"]);
    expect(fakes.size).toBe(1);

    // Drive the player's ticks; each tick awaits storage, so drain microtasks
    // until it schedules the next one (or reports the end).
    for (let guard = 0; guard < 1000; guard++) {
      if (!queue.length) {
        for (let i = 0; i < 5000 && !queue.length && !replayStatuses.at(-1)?.ended; i++) await Promise.resolve();
        if (!queue.length) break;
      }
      wall += 50;
      queue.shift()!();
    }
    jest.advanceTimersByTime(60);
    const final = replayStatuses.at(-1)!;
    expect(final.ended).toBe(true);
    expect(final.playing).toBe(false);

    const state = replayStore.getState();
    const replayCandles = [...state.candles, state.currentCandle!];
    expect(replayCandles.map((c) => [c.openTime, c.volume, c.delta, c.tradeCount])).toEqual(
      liveCandles.map((c) => [c.openTime, c.volume, c.delta, c.tradeCount])
    );
    // Replayed liquidations pass the staleness filter because the clock is virtual.
    expect(state.liquidations.map((l) => l.id)).toEqual(["liq-1"]);
    expect(state.orderBook).not.toBeNull();
    expect(state.marketClock).toBe(meta.endedAt);

    // Seeking backwards rebuilds from the start.
    await player.seek(T0 + 10_000);
    jest.advanceTimersByTime(60);
    const seeked = replayStore.getState();
    const seekedVolume = [...seeked.candles, seeked.currentCandle!].reduce((sum, c) => sum + c.volume, 0);
    const expected = Array.from({ length: 101 }, (_, i) => 1 + (i % 3)).reduce((a, b) => a + b, 0);
    expect(seekedVolume).toBe(expected);
    expect(seeked.liquidations).toHaveLength(0);
    player.dispose();
    replay.endReplay();
    live.disconnect();
  });

  it("closes the recording when the market selection changes", async () => {
    const storage = new MemoryRecordingStorage();
    const store = createTerminalStore();
    const manager = new MarketDataManager(store);
    manager.subscribe("bybit-futures", "BTCUSDT", "perpetual", "1m", 10, 3, ["bybit-futures"]);
    const ended: string[] = [];
    const recorder = new SessionRecorder({
      storage,
      meta: { id: "rec-2", symbol: "BTCUSDT", venue: "bybit-futures", selectedVenues: ["bybit-futures"], marketType: "perpetual", timeframe: "1m", imbalanceThreshold: 3, startedAt: T0 },
      onStatus: () => undefined,
      onEnd: (reason) => ended.push(reason),
    });
    await recorder.start();
    manager.setRecorder(recorder);
    fakes.get("bybit-futures")!.emit("trade", trade(1, 50_000));
    manager.subscribe("bybit-futures", "ETHUSDT", "perpetual", "1m", 10, 3, ["bybit-futures"]);
    await flushPromises();
    expect(manager.isRecording).toBe(false);
    expect(ended).toEqual(["market changed"]);
    expect((await storage.getMeta("rec-2"))?.events).toBe(1);
    manager.disconnect();
  });
});
