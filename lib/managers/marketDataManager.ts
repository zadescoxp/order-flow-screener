// ============================================================
// MARKET DATA MANAGER
// Manages adapter lifecycle, feeds data into the order-flow engine
// and dispatches batched, normalized events to the session store.
// ============================================================

"use client";

import { venueSupports, venuesForSelection } from "@/lib/adapters/capabilities";
import { acquireAdapter, releaseAdapter } from "@/lib/session/adapterPool";
import { aggregateBooks, computeBandObi } from "@/lib/aggregation/marketAggregation";
import type { BaseExchangeAdapter } from "@/lib/adapters/base";
import {
  getCandleOpenTime,
  createEmptyCandle,
  applyTradeToCandle,
  applyZScores,
  computeVolumeProfile,
  computeOBI,
} from "@/lib/engine/orderFlowEngine";
import {
  applyTradeToSession,
  createFlowBar,
  createSessionStats,
  resolveTickSize,
} from "@/lib/engine/analytics";
import { aggregateDerivatives, mergeDerivatives } from "@/lib/engine/derivatives";
import type { MarketDataBatch, TerminalStore } from "@/lib/store/terminalStore";
import type { StoreApi } from "zustand";
import type {
  Venue,
  VenueSelection,
  Timeframe,
  MarketType,
  NormalizedTrade,
  NormalizedOrderBook,
  FootprintCandle,
  FootprintLevel,
  OBISnapshot,
  FlowBar,
  MarketTicker,
  SessionStats,
  VenueConnection,
  NormalizedLiquidation,
  DerivativesSnapshot,
  DerivativesAggregate,
  OpenInterestPoint,
  BigTrade,
} from "@/lib/types/market";
import { RingBuffer } from "@/lib/session/RingBuffer";
import { DepthHistory, bookSides, type DepthSide } from "@/lib/engine/depthHistory";
import { AbsorptionDetector, IcebergDetector, type MicroEvent } from "@/lib/engine/microstructure";
import { VenueTracker } from "@/lib/engine/venues";

const FLOW_BAR_MS = 1000;
const MAX_GAP_FILL_BARS = 120;
const FLUSH_INTERVAL_MS = 50;
const OI_SAMPLE_MS = 1000;
// Wait this long for every perp venue to report open interest before the
// summed series starts, so the total doesn't step up when a slow venue lands.
const OI_LOCK_GRACE_MS = 15_000;
const MAX_LIQUIDATION_AGE_MS = 60_000;
/** Prints at least this many × the session average are kept as big trades. */
export const BIG_TRADE_MIN_RATIO = 5;
/** Average print size needs this many trades before big-trade ratios mean anything. */
const BIG_TRADE_WARMUP_TRADES = 50;
/** Icebergs must trade at least this many × the average print. */
const ICEBERG_MIN_PRINT_RATIO = 10;
/** Executed prints kept for export (the visible tape keeps only 500). */
export const TAPE_LOG_SIZE = 20_000;

/** Receives every normalized event the manager accepts (used by the recorder). */
export interface MarketEventSink {
  trade(trade: NormalizedTrade, at: number): void;
  book(book: NormalizedOrderBook, at: number): void;
  liquidation(liquidation: NormalizedLiquidation, at: number): void;
  derivatives(snapshot: DerivativesSnapshot, at: number): void;
  seed(books: NormalizedOrderBook[], derivatives: DerivativesSnapshot[], at: number): void;
  depth(snapshot: { tick: number; index: Int32Array; size: Float32Array }, at: number): void;
  /** The market selection changed or the feed was torn down. */
  close(): void;
}

export interface ReplayConfig {
  venue: VenueSelection;
  symbol: string;
  marketType: MarketType;
  timeframe: Timeframe;
  imbalanceThreshold: number;
  selectedVenues: Venue[];
}

export class MarketDataManager {
  private readonly store: StoreApi<TerminalStore>;
  private adapters = new Map<Venue, BaseExchangeAdapter>();
  private books = new Map<Venue, NormalizedOrderBook>();
  private listeners = new Map<Venue, {
    tradeListener: (trade: NormalizedTrade) => void;
    bookListener: (book: NormalizedOrderBook) => void;
    statusListener: (conn: VenueConnection) => void;
    liquidationListener: (liquidation: NormalizedLiquidation) => void;
    derivativesListener: (snapshot: DerivativesSnapshot) => void;
  }>();
  private currentSymbol = "";
  private currentVenue: VenueSelection | null = null;
  private currentSelectedVenues: Venue[] = [];
  private currentMarketType: MarketType = "perpetual";
  private currentTimeframe: Timeframe = "5m";
  private currentTickSize = 10;
  private tickResolved = false;
  private currentImbalanceThreshold = 3;

  // Working candle state
  private currentCandleRef: FootprintCandle | null = null;
  private allLevels: FootprintLevel[] = []; // rolling window for level z-score
  private cumulativeDelta = 0; // delta of all finalized candles

  // Flow bars & session
  private liveBar: FlowBar | null = null;
  private sessionCvd = 0;
  private session: SessionStats | null = null;

  private paused = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTrades: NormalizedTrade[] = [];
  private pendingOrderBook: NormalizedOrderBook | null = null;
  private pendingAggregatedBook: ReturnType<typeof aggregateBooks> = null;
  private pendingConnections = new Map<Venue, VenueConnection>();
  private pendingCandle: FootprintCandle | null = null;
  private profileDirty = false;
  private pendingTicker: MarketTicker | null = null;
  private pendingOBI: OBISnapshot | null = null;
  private pendingFlowBars: FlowBar[] = [];

  // Derivatives (perpetuals)
  private derivatives = new Map<Venue, DerivativesSnapshot>();
  private derivativesDirty = false;
  private pendingLiquidations: NormalizedLiquidation[] = [];
  private seenLiquidations = new Set<string>();
  private pendingOIPoints: OpenInterestPoint[] = [];
  private oiVenues: Set<Venue> | null = null;
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedAt = 0;
  private lastPrice = 0;

  // Big trades, export log, recording and replay
  private pendingBigTrades: BigTrade[] = [];
  private tapeLog = new RingBuffer<NormalizedTrade>(TAPE_LOG_SIZE);
  private recorder: MarketEventSink | null = null;
  private replaying = false;
  private replayClock = 0;
  private lastSecondSample = 0;

  // Microstructure
  /** One-second resting-liquidity snapshots for the heatmap (read by the footprint). */
  readonly depthHistory = new DepthHistory();
  private depthDirty = false;
  private absorption = new AbsorptionDetector(0);
  private icebergs = new IcebergDetector();
  private pendingMicro: MicroEvent[] = [];
  private venueTracker = new VenueTracker();
  private venueDirty = false;
  private lastVenueCopy = 0;
  private lastMid = 0;
  /** Wall time when live; the replay's virtual time during a replay. */
  private clock = (): number => (this.replaying ? this.replayClock : Date.now());

  constructor(store: StoreApi<TerminalStore>) {
    this.store = store;
  }

  subscribe(
    venue: VenueSelection,
    symbol: string,
    marketType: MarketType,
    timeframe: Timeframe,
    tickSize: number,
    imbalanceThreshold: number,
    selectedVenues?: Venue[]
  ): void {
    // While a recording is replaying, the live feed stays disconnected.
    if (this.replaying) return;
    const venues = selectedVenues?.length
      ? selectedVenues
      : venuesForSelection(venue, marketType, symbol);
    if (!venues.length || venues.some((selected) => !venueSupports(selected, symbol, marketType))) {
      this.store.getState().updateConnection({
        venue: venues[0] ?? "bybit-futures",
        status: "error",
        lastHeartbeat: 0,
        reconnectAttempts: 0,
        error: `${venue} does not support ${symbol} ${marketType}`,
      });
      return;
    }
    if (
      this.adapters.size > 0 &&
      this.currentVenue === venue &&
      JSON.stringify(this.currentSelectedVenues) === JSON.stringify(venues) &&
      this.currentSymbol === symbol &&
      this.currentTimeframe === timeframe
    ) {
      return;
    }

    this.disconnect();

    this.currentVenue = venue;
    this.currentSelectedVenues = [...venues];
    this.currentSymbol = symbol;
    this.currentMarketType = marketType;
    this.currentTimeframe = timeframe;
    this.currentTickSize = tickSize;
    this.tickResolved = false;
    this.currentImbalanceThreshold = imbalanceThreshold;

    for (const selectedVenue of venues) {
      const adapter = acquireAdapter(selectedVenue, symbol, marketType);
      if (!adapter) continue;
      const tradeListener = (trade: NormalizedTrade) => this.onTrade(trade);
      const bookListener = (book: NormalizedOrderBook) => this.onOrderBook(book);
      const statusListener = (conn: VenueConnection) => {
        this.pendingConnections.set(conn.venue, conn);
        this.scheduleFlush();
      };
      const liquidationListener = (liquidation: NormalizedLiquidation) => this.onLiquidation(liquidation);
      const derivativesListener = (snapshot: DerivativesSnapshot) => this.onDerivatives(snapshot);
      adapter.on("trade", tradeListener);
      adapter.on("orderbook", bookListener);
      adapter.on("status", statusListener);
      adapter.on("liquidation", liquidationListener);
      adapter.on("derivatives", derivativesListener);
      this.adapters.set(selectedVenue, adapter);
      this.listeners.set(selectedVenue, { tradeListener, bookListener, statusListener, liquidationListener, derivativesListener });
    }

    this.subscribedAt = Date.now();
    this.secondTimer = setInterval(() => this.sampleSecond(Date.now()), OI_SAMPLE_MS);
  }

  /** Once-a-second work: open interest, depth snapshot, iceberg confirmation, venue stats. */
  private sampleSecond(now: number): void {
    if (this.paused && !this.replaying) return;
    if (this.currentMarketType === "perpetual") this.sampleOpenInterest(now);
    // Live: sample each venue's full in-memory book. Replay: depth comes from recorded snapshots.
    if (!this.replaying && this.tickResolved && this.books.size) {
      const sides: DepthSide[] = [];
      for (const [venue, book] of this.books) sides.push(this.adapters.get(venue)?.depthSides?.() ?? bookSides(book));
      const mid = this.lastMid || this.lastPrice;
      const snapshot = this.depthHistory.add(now, sides, this.currentTickSize, mid);
      if (snapshot) {
        this.depthDirty = true;
        this.recorder?.depth({ tick: this.currentTickSize, index: snapshot.index, size: snapshot.size }, now);
      }
    }
    if (this.session && this.session.trades >= BIG_TRADE_WARMUP_TRADES) {
      const average = this.session.volume / this.session.trades;
      const found = this.icebergs.evaluate(this.trackTime(), average * ICEBERG_MIN_PRINT_RATIO);
      if (found.length) this.pendingMicro.push(...found);
    }
    this.scheduleFlush();
  }

  /** Exchange-time "now" for detectors that compare against trade timestamps. */
  private trackTime(): number {
    return this.session ? Math.max(this.clock(), this.session.startTime) : this.clock();
  }

  // ─── Recording ─────────────────────────────────────────────────
  setRecorder(recorder: MarketEventSink | null): void {
    this.recorder = recorder;
    if (recorder) recorder.seed([...this.books.values()], [...this.derivatives.values()], this.clock());
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  get tapeLogSize(): number {
    return this.tapeLog.size;
  }

  /** Executed prints for export, newest first. */
  getTapeLog(): NormalizedTrade[] {
    return this.tapeLog.newestFirst();
  }

  // ─── Replay ────────────────────────────────────────────────────
  /** Tear down the live feed and reset state so recorded events can be fed in. */
  beginReplay(config: ReplayConfig, startTime: number): void {
    this.replaying = false;
    this.disconnect();
    this.replaying = true;
    this.replayClock = startTime;
    this.lastSecondSample = Math.floor(startTime / OI_SAMPLE_MS) * OI_SAMPLE_MS;
    this.subscribedAt = startTime;
    this.currentVenue = config.venue;
    this.currentSelectedVenues = [...config.selectedVenues];
    this.currentSymbol = config.symbol;
    this.currentMarketType = config.marketType;
    this.currentTimeframe = config.timeframe;
    this.currentImbalanceThreshold = config.imbalanceThreshold;
    this.tickResolved = false;
  }

  /** Feed one recorded event; `at` is its original arrival time. */
  ingest(kind: "t" | "b" | "l" | "d" | "h", payload: unknown, at: number): void {
    if (!this.replaying) return;
    this.advanceClock(at);
    if (kind === "h") {
      const depth = payload as { tick: number; index: Int32Array; size: Float32Array };
      if (this.depthHistory.addSnapshot(at, depth.index, depth.size, depth.tick)) this.depthDirty = true;
      this.scheduleFlush();
      return;
    }
    if (kind === "t") this.onTrade(payload as NormalizedTrade);
    else if (kind === "b") this.onOrderBook(payload as NormalizedOrderBook);
    else if (kind === "l") this.onLiquidation(payload as NormalizedLiquidation);
    else this.onDerivatives(payload as DerivativesSnapshot);
  }

  /** Move the virtual clock forward, running the once-a-second work for each second crossed. */
  advanceClock(time: number): void {
    if (!this.replaying || time <= this.replayClock) return;
    this.replayClock = time;
    const target = Math.floor(time / OI_SAMPLE_MS) * OI_SAMPLE_MS;
    // Bound the catch-up after a long gap in the recording.
    let next = Math.max(this.lastSecondSample + OI_SAMPLE_MS, target - 120 * OI_SAMPLE_MS);
    for (; next <= target; next += OI_SAMPLE_MS) this.sampleSecond(next);
    this.lastSecondSample = target;
  }

  /** Flush whatever is pending right away (used after a fast-forward). */
  flushNow(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }

  endReplay(): void {
    if (!this.replaying) return;
    this.disconnect();
    this.replaying = false;
    this.currentVenue = null;
    this.currentSelectedVenues = [];
    this.currentSymbol = "";
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  disconnect(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pendingTrades = [];
    this.pendingOrderBook = null;
    this.pendingAggregatedBook = null;
    this.pendingCandle = null;
    this.profileDirty = false;
    this.pendingTicker = null;
    this.pendingOBI = null;
    this.pendingFlowBars = [];
    this.pendingConnections.clear();
    if (this.secondTimer) clearInterval(this.secondTimer);
    this.secondTimer = null;
    this.depthHistory.clear();
    this.depthDirty = false;
    this.lastMid = 0;
    this.absorption = new AbsorptionDetector(0);
    this.icebergs.reset();
    this.pendingMicro = [];
    this.venueTracker.clear();
    this.venueDirty = false;
    this.derivatives.clear();
    this.derivativesDirty = false;
    this.pendingLiquidations = [];
    this.seenLiquidations.clear();
    this.pendingOIPoints = [];
    this.oiVenues = null;
    this.lastPrice = 0;
    this.pendingBigTrades = [];
    this.tapeLog.clear();
    if (this.recorder) {
      const recorder = this.recorder;
      this.recorder = null;
      recorder.close();
    }
    for (const [venue, adapter] of this.adapters) {
      const listeners = this.listeners.get(venue);
      if (listeners) {
        adapter.removeListener("trade", listeners.tradeListener);
        adapter.removeListener("orderbook", listeners.bookListener);
        adapter.removeListener("status", listeners.statusListener);
        adapter.removeListener("liquidation", listeners.liquidationListener);
        adapter.removeListener("derivatives", listeners.derivativesListener);
      }
      releaseAdapter(venue, this.currentSymbol, this.currentMarketType);
    }
    this.adapters.clear();
    this.listeners.clear();
    this.books.clear();
    this.currentCandleRef = null;
    this.allLevels = [];
    this.cumulativeDelta = 0;
    this.liveBar = null;
    this.sessionCvd = 0;
    this.session = null;
    this.store.getState().resetMarketData();
  }

  private get primaryVenue(): Venue | undefined {
    return this.currentSelectedVenues[0];
  }

  private onTrade(trade: NormalizedTrade): void {
    if (this.paused && !this.replaying) return;
    if (!Number.isFinite(trade.price) || trade.price <= 0) return;
    this.recorder?.trade(trade, this.clock());
    const store = this.store.getState();
    this.lastPrice = trade.price;

    // Footprint rows are sized from the instrument's price on the first print.
    if (!this.tickResolved) {
      this.tickResolved = true;
      this.currentTickSize = resolveTickSize(trade.price, this.currentMarketType);
      if (store.tickSize !== this.currentTickSize) store.setTickSize(this.currentTickSize);
      this.absorption.setTick(this.currentTickSize);
    }

    const absorbed = this.absorption.onTrade(trade);
    if (absorbed.length) this.pendingMicro.push(...absorbed);
    this.icebergs.onTrade(trade, this.books.get(trade.venue));
    this.venueTracker.onTrade(trade);
    this.venueDirty = true;

    const candleOpenTime = getCandleOpenTime(trade.timestamp, this.currentTimeframe);

    if (!this.currentCandleRef || this.currentCandleRef.openTime !== candleOpenTime) {
      if (this.currentCandleRef) {
        const finalized = { ...this.currentCandleRef, complete: true };
        this.cumulativeDelta += finalized.delta;
        finalized.cumulativeDelta = this.cumulativeDelta;
        store.finalizeCandle(finalized);

        for (const level of finalized.levels.values()) this.allLevels.push(level);
        if (this.allLevels.length > 5000) this.allLevels = this.allLevels.slice(-3000);
      }
      this.currentCandleRef = createEmptyCandle(candleOpenTime, this.currentTimeframe);
    }

    this.currentCandleRef = applyTradeToCandle(
      this.currentCandleRef,
      trade,
      this.currentTickSize,
      this.currentImbalanceThreshold
    );
    this.currentCandleRef.cumulativeDelta = this.cumulativeDelta + this.currentCandleRef.delta;

    if (this.allLevels.length > 1) applyZScores(this.currentCandleRef, this.allLevels);

    // Session statistics & VWAP
    if (!this.session) this.session = createSessionStats(trade.timestamp, trade.price);
    applyTradeToSession(
      this.session,
      trade.price,
      trade.quantity,
      trade.side,
      Math.max(0, trade.localTimestamp - trade.timestamp)
    );
    this.currentCandleRef.vwap = this.session.vwap;
    this.currentCandleRef.vwapStd = this.session.vwapStd;

    // Big prints relative to the session's average print size so far.
    if (this.session.trades >= BIG_TRADE_WARMUP_TRADES) {
      const average = this.session.volume / this.session.trades;
      const ratio = average > 0 ? trade.quantity / average : 0;
      if (ratio >= BIG_TRADE_MIN_RATIO) this.pendingBigTrades.push({ ...trade, ratio });
    }
    this.tapeLog.push(trade);

    this.updateFlowBar(trade);

    this.pendingCandle = { ...this.currentCandleRef };
    this.profileDirty = true;

    const candle = this.currentCandleRef;
    this.pendingTicker = {
      venue: trade.venue,
      symbol: trade.symbol,
      price: trade.price,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      change: trade.price - candle.open,
      changePct: candle.open ? ((trade.price - candle.open) / candle.open) * 100 : 0,
      volume: candle.volume,
      timestamp: trade.timestamp,
    };

    this.pendingTrades.push(trade);
    this.scheduleFlush();
  }

  /** Accumulate the trade into fixed 1-second flow bars, filling empty seconds. */
  private updateFlowBar(trade: NormalizedTrade): void {
    const bucket = Math.floor(trade.timestamp / FLOW_BAR_MS) * FLOW_BAR_MS;
    if (this.liveBar && bucket < this.liveBar.time) {
      // Late print from a slower venue — fold it into the current bar.
    } else if (!this.liveBar || bucket > this.liveBar.time) {
      if (this.liveBar) {
        const previous = this.liveBar;
        this.pendingFlowBars.push(previous);
        const missing = Math.min(MAX_GAP_FILL_BARS, (bucket - previous.time) / FLOW_BAR_MS - 1);
        for (let i = 1; i <= missing; i++) {
          this.pendingFlowBars.push(
            createFlowBar(previous.time + i * FLOW_BAR_MS, previous.close, previous.cvd)
          );
        }
      }
      this.liveBar = createFlowBar(bucket, trade.price, this.sessionCvd);
    }

    const bar = this.liveBar!;
    const signed = trade.side === "buy" ? trade.quantity : -trade.quantity;
    this.sessionCvd += signed;
    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.close = trade.price;
    bar.volume += trade.quantity;
    if (trade.side === "buy") bar.buyVolume += trade.quantity;
    else bar.sellVolume += trade.quantity;
    bar.trades += 1;
    bar.cvd = this.sessionCvd;
  }

  private onOrderBook(book: NormalizedOrderBook): void {
    if (this.paused && !this.replaying) return;
    this.recorder?.book(book, this.clock());

    this.books.set(book.venue, book);
    this.icebergs.onBook(book);
    const aggregate = aggregateBooks(this.books);
    if (!aggregate) return;
    const { bidVolume, askVolume } = computeBandObi(this.books, aggregate);

    this.pendingOBI = {
      timestamp: book.timestamp,
      value: computeOBI(bidVolume, askVolume),
      bidVolume,
      askVolume,
    };
    // The single-venue book always tracks the primary venue so it doesn't
    // jump between exchanges when several are subscribed.
    if (book.venue === this.primaryVenue || !this.primaryVenue) {
      this.pendingOrderBook = book;
    }
    this.pendingAggregatedBook = aggregate;
    if (aggregate.midPrice > 0) this.lastMid = aggregate.midPrice;
    this.scheduleFlush();
  }

  private onLiquidation(liquidation: NormalizedLiquidation): void {
    if (!this.replaying && (this.paused || !this.adapters.has(liquidation.venue))) return;
    // Some feeds (OKX) replay the last known liquidation long after the fact,
    // and snapshot-style feeds can repeat a record; keep only fresh, unseen ones.
    if (liquidation.timestamp < this.clock() - MAX_LIQUIDATION_AGE_MS) return;
    if (this.seenLiquidations.has(liquidation.id)) return;
    this.seenLiquidations.add(liquidation.id);
    if (this.seenLiquidations.size > 10_000) {
      this.seenLiquidations = new Set([...this.seenLiquidations].slice(-5_000));
    }
    this.recorder?.liquidation(liquidation, this.clock());
    this.pendingLiquidations.push(liquidation);
    this.scheduleFlush();
  }

  private onDerivatives(update: DerivativesSnapshot): void {
    if (!this.replaying && (this.paused || !this.adapters.has(update.venue))) return;
    const merged = mergeDerivatives(this.derivatives.get(update.venue), update);
    this.derivatives.set(update.venue, merged);
    this.recorder?.derivatives(merged, this.clock());
    this.derivativesDirty = true;
    this.scheduleFlush();
  }

  private computeDerivatives(): DerivativesAggregate | null {
    return aggregateDerivatives(
      [...this.derivatives.values()],
      this.primaryVenue,
      this.lastPrice || undefined,
      this.oiVenues ?? undefined
    );
  }

  /** Sample summed open interest once a second, against the last traded price. */
  private sampleOpenInterest(now: number): void {
    if ((this.paused && !this.replaying) || !this.lastPrice) return;
    const reporting = [...this.derivatives.values()].filter((s) => s.openInterest !== undefined).map((s) => s.venue);
    if (!this.oiVenues) {
      const allReported = this.currentSelectedVenues.every((v) => reporting.includes(v));
      if (!reporting.length || (!allReported && now - this.subscribedAt < OI_LOCK_GRACE_MS)) return;
      this.oiVenues = new Set(reporting);
      this.derivativesDirty = true;
    }
    const aggregate = this.computeDerivatives();
    if (aggregate?.openInterest == null) return;
    this.pendingOIPoints.push({
      time: Math.floor(now / OI_SAMPLE_MS) * OI_SAMPLE_MS,
      openInterest: aggregate.openInterest,
      price: this.lastPrice,
    });
    this.scheduleFlush();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || (this.paused && !this.replaying)) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    const store = this.store.getState();
    const volumeProfile =
      this.profileDirty && this.currentCandleRef
        ? computeVolumeProfile([...store.candles, this.currentCandleRef], store.valueAreaPct)
        : null;
    const batch: MarketDataBatch = {
      trades: this.pendingTrades,
      orderBook: this.pendingOrderBook,
      aggregatedBook: this.pendingAggregatedBook,
      candle: this.pendingCandle,
      volumeProfile,
      ticker: this.pendingTicker,
      obi: this.pendingOBI,
      flowBars: this.pendingFlowBars,
      liveBar: this.liveBar ? { ...this.liveBar } : null,
      session: this.session ? { ...this.session } : null,
      connections: [...this.pendingConnections.values()],
      liquidations: this.pendingLiquidations,
      derivatives: this.derivativesDirty ? this.computeDerivatives() : null,
      oiPoints: this.pendingOIPoints,
        bigTrades: this.pendingBigTrades,
        clock: this.clock(),
      depthVersion: this.depthDirty ? this.depthHistory.version : 0,
      microEvents: this.pendingMicro,
      // Per-venue buckets are only worth copying when several venues are compared.
      venueBuckets: this.venueDirty && this.currentSelectedVenues.length > 1 && this.lastVenueCopy + 1000 <= this.clock()
        ? ((this.lastVenueCopy = this.clock()), this.venueTracker.snapshot())
        : null,
    };
    store.applyMarketDataBatch(batch);
    this.pendingTrades = [];
    this.pendingOrderBook = null;
    this.pendingAggregatedBook = null;
    this.pendingCandle = null;
    this.profileDirty = false;
    this.pendingTicker = null;
    this.pendingOBI = null;
    this.pendingFlowBars = [];
    this.pendingConnections.clear();
    this.pendingLiquidations = [];
    this.pendingOIPoints = [];
    this.pendingBigTrades = [];
    this.derivativesDirty = false;
    this.depthDirty = false;
    this.pendingMicro = [];
    if (batch.venueBuckets) this.venueDirty = false;
  }
}
