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
} from "@/lib/types/market";

const FLOW_BAR_MS = 1000;
const MAX_GAP_FILL_BARS = 120;
const FLUSH_INTERVAL_MS = 50;

export class MarketDataManager {
  private readonly store: StoreApi<TerminalStore>;
  private adapters = new Map<Venue, BaseExchangeAdapter>();
  private books = new Map<Venue, NormalizedOrderBook>();
  private listeners = new Map<Venue, {
    tradeListener: (trade: NormalizedTrade) => void;
    bookListener: (book: NormalizedOrderBook) => void;
    statusListener: (conn: VenueConnection) => void;
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
      adapter.on("trade", tradeListener);
      adapter.on("orderbook", bookListener);
      adapter.on("status", statusListener);
      this.adapters.set(selectedVenue, adapter);
      this.listeners.set(selectedVenue, { tradeListener, bookListener, statusListener });
    }
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
    for (const [venue, adapter] of this.adapters) {
      const listeners = this.listeners.get(venue);
      if (listeners) {
        adapter.removeListener("trade", listeners.tradeListener);
        adapter.removeListener("orderbook", listeners.bookListener);
        adapter.removeListener("status", listeners.statusListener);
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
    if (this.paused) return;
    if (!Number.isFinite(trade.price) || trade.price <= 0) return;
    const store = this.store.getState();

    // Footprint rows are sized from the instrument's price on the first print.
    if (!this.tickResolved) {
      this.tickResolved = true;
      this.currentTickSize = resolveTickSize(trade.price, this.currentMarketType);
      if (store.tickSize !== this.currentTickSize) store.setTickSize(this.currentTickSize);
    }

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
    if (this.paused) return;

    this.books.set(book.venue, book);
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
    if (this.flushTimer || this.paused) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
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
    }, FLUSH_INTERVAL_MS);
  }
}
