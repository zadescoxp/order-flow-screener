// ============================================================
// MARKET DATA MANAGER
// Manages adapter lifecycle, feeds data into order-flow engine
// and dispatches normalized events to the Zustand store
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
  computeZScore,
} from "@/lib/engine/orderFlowEngine";
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
  ZScorePoint,
} from "@/lib/types/market";

export class MarketDataManager {
  private readonly store: StoreApi<TerminalStore>;
  private adapters = new Map<Venue, BaseExchangeAdapter>();
  private books = new Map<Venue, NormalizedOrderBook>();
  private listeners = new Map<Venue, {
    tradeListener: (trade: NormalizedTrade) => void;
    bookListener: (book: NormalizedOrderBook) => void;
    statusListener: (conn: Parameters<TerminalStore["updateConnection"]>[0]) => void;
  }>();
  private currentSymbol = "";
  private currentVenue: VenueSelection | null = null;
  private currentSelectedVenues: Venue[] = [];
  private currentMarketType: MarketType = "perpetual";
  private currentTimeframe: Timeframe = "5m";
  private currentTickSize = 10;
  private currentImbalanceThreshold = 3;

  // Working candle state
  private currentCandleRef: FootprintCandle | null = null;
  private allLevels: FootprintLevel[] = []; // rolling window for z-score

  // OBI rolling window
  private bidDepthWindow: number[] = [];
  private askDepthWindow: number[] = [];

  // Z-score rolling volume window
  private volumeWindow: number[] = [];

  // Cumulative delta
  private cumulativeDelta = 0;
  private paused = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTrades: NormalizedTrade[] = [];
  private pendingOrderBook: NormalizedOrderBook | null = null;
  private pendingAggregatedBook: ReturnType<typeof aggregateBooks> = null;
  private pendingConnections = new Map<Venue, Parameters<TerminalStore["updateConnection"]>[0]>();
  private pendingCandle: FootprintCandle | null = null;
  private pendingVolumeProfile: ReturnType<typeof computeVolumeProfile> | null = null;
  private pendingTicker: Parameters<TerminalStore["updateTicker"]>[0] | null = null;
  private pendingOBI: OBISnapshot | null = null;
  private pendingZScores: ZScorePoint[] = [];

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
    this.currentImbalanceThreshold = imbalanceThreshold;

    for (const selectedVenue of venues) {
      const adapter = acquireAdapter(selectedVenue, symbol, marketType);
      if (!adapter) continue;
      const tradeListener = (trade: NormalizedTrade) => this.onTrade(trade);
      const bookListener = (book: NormalizedOrderBook) => this.onOrderBook(book);
      const statusListener = (conn: Parameters<TerminalStore["updateConnection"]>[0]) => {
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
    this.pendingVolumeProfile = null;
    this.pendingTicker = null;
    this.pendingOBI = null;
    this.pendingZScores = [];
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
    this.volumeWindow = [];
    this.cumulativeDelta = 0;
    this.store.getState().resetMarketData();
  }

  private toOKXSymbol(symbol: string, type: "perpetual" | "spot"): string {
    const base = symbol.replace("USDT", "").replace("USD", "");
    if (type === "perpetual") return `${base}-USDT-SWAP`;
    return `${base}-USDT`;
  }

  private onTrade(trade: NormalizedTrade): void {
    if (this.paused) return;
    const store = this.store.getState();

    const candleOpenTime = getCandleOpenTime(trade.timestamp, this.currentTimeframe);

    // Check if we need a new candle
    if (!this.currentCandleRef || this.currentCandleRef.openTime !== candleOpenTime) {
      if (this.currentCandleRef) {
        // Finalize current candle
        const finalized = { ...this.currentCandleRef, complete: true };
        this.cumulativeDelta += finalized.delta;
        finalized.cumulativeDelta = this.cumulativeDelta;
        store.finalizeCandle(finalized);

        // Collect all levels for z-score window
        for (const level of finalized.levels.values()) {
          this.allLevels.push(level);
        }
        // Keep rolling window
        if (this.allLevels.length > 5000) {
          this.allLevels = this.allLevels.slice(-3000);
        }

        // Volume profile
        const allCandles = [...store.candles];
        if (allCandles.length > 0) {
          this.pendingVolumeProfile = computeVolumeProfile(allCandles);
        }
      }

      this.currentCandleRef = createEmptyCandle(candleOpenTime, this.currentTimeframe);
    }

    // Apply trade to current candle
    this.currentCandleRef = applyTradeToCandle(
      this.currentCandleRef,
      trade,
      this.currentTickSize,
      this.currentImbalanceThreshold
    );

    // Apply z-scores
    if (this.allLevels.length > 1) {
      applyZScores(this.currentCandleRef, this.allLevels);
    }

    // Update store with current candle
    this.pendingCandle = { ...this.currentCandleRef };
    this.pendingVolumeProfile = computeVolumeProfile([
      ...store.candles,
      this.currentCandleRef,
    ]);

    // Update ticker
    this.pendingTicker = {
      venue: trade.venue,
      symbol: trade.symbol,
      price: trade.price,
      open: this.currentCandleRef.open,
      high: this.currentCandleRef.high,
      low: this.currentCandleRef.low,
      change: trade.price - this.currentCandleRef.open,
      changePct: ((trade.price - this.currentCandleRef.open) / this.currentCandleRef.open) * 100,
      volume: this.currentCandleRef.volume,
      timestamp: trade.timestamp,
    };

    // Z-score on volume
    this.volumeWindow.push(trade.quantity);
    if (this.volumeWindow.length > 200) this.volumeWindow.shift();
    const zScore = computeZScore(this.volumeWindow, trade.quantity);
    const zPoint: ZScorePoint = {
      timestamp: trade.timestamp,
      value: zScore,
      volume: trade.quantity,
    };
    this.pendingZScores.push(zPoint);
    this.pendingTrades.push(trade);
    this.scheduleFlush();
  }

  private onOrderBook(book: NormalizedOrderBook): void {
    if (this.paused) return;

    this.books.set(book.venue, book);
    const aggregate = aggregateBooks(this.books);
    if (!aggregate) return;
    const { bidVolume: bidVol, askVolume: askVol } = computeBandObi(this.books, aggregate);
    const obi = computeOBI(bidVol, askVol);

    const snap: OBISnapshot = {
      timestamp: book.timestamp,
      value: obi,
      bidVolume: bidVol,
      askVolume: askVol,
    };
    this.pendingOrderBook = {
      ...book,
    };
    this.pendingAggregatedBook = aggregate;
    this.pendingOBI = snap;
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
      const batch: MarketDataBatch = {
        trades: this.pendingTrades,
        orderBook: this.pendingOrderBook,
        aggregatedBook: this.pendingAggregatedBook,
        candle: this.pendingCandle,
        volumeProfile: this.pendingVolumeProfile,
        ticker: this.pendingTicker,
        obi: this.pendingOBI,
        zScores: this.pendingZScores,
        connections: [...this.pendingConnections.values()],
      };
      store.applyMarketDataBatch(batch);
      this.pendingTrades = [];
      this.pendingOrderBook = null;
      this.pendingAggregatedBook = null;
      this.pendingCandle = null;
      this.pendingVolumeProfile = null;
      this.pendingTicker = null;
      this.pendingOBI = null;
      this.pendingZScores = [];
      this.pendingConnections.clear();
    }, 50);
  }
}
