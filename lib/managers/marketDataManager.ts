// ============================================================
// MARKET DATA MANAGER
// Manages adapter lifecycle, feeds data into order-flow engine
// and dispatches normalized events to the Zustand store
// ============================================================

"use client";

import { venueSupports } from "@/lib/adapters/capabilities";
import { acquireAdapter, releaseAdapter } from "@/lib/session/adapterPool";
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
import { useTerminalStore } from "@/lib/store/terminalStore";
import type { TerminalStore } from "@/lib/store/terminalStore";
import type { StoreApi } from "zustand";
import type {
  Venue,
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
  private adapter: BaseExchangeAdapter | null = null;
  private currentSymbol = "";
  private currentVenue: Venue | null = null;
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
  private pendingConnection: Parameters<TerminalStore["updateConnection"]>[0] | null = null;
  private pendingCandle: FootprintCandle | null = null;
  private pendingTicker: Parameters<TerminalStore["updateTicker"]>[0] | null = null;
  private pendingOBI: OBISnapshot | null = null;
  private pendingZScores: ZScorePoint[] = [];
  private tradeListener: ((trade: NormalizedTrade) => void) | null = null;
  private bookListener: ((book: NormalizedOrderBook) => void) | null = null;
  private statusListener: ((conn: Parameters<TerminalStore["updateConnection"]>[0]) => void) | null = null;

  constructor(store: StoreApi<TerminalStore>) {
    this.store = store;
  }

  subscribe(
    venue: Venue,
    symbol: string,
    marketType: MarketType,
    timeframe: Timeframe,
    tickSize: number,
    imbalanceThreshold: number
  ): void {
    if (!venueSupports(venue, symbol, marketType)) {
      this.store.getState().updateConnection({
        venue,
        status: "error",
        lastHeartbeat: 0,
        reconnectAttempts: 0,
        error: `${venue} does not support ${symbol} ${marketType}`,
      });
      return;
    }
    if (
      this.adapter !== null &&
      this.currentVenue === venue &&
      this.currentSymbol === symbol &&
      this.currentTimeframe === timeframe
    ) {
      return;
    }

    this.disconnect();

    this.currentVenue = venue;
    this.currentSymbol = symbol;
    this.currentMarketType = marketType;
    this.currentTimeframe = timeframe;
    this.currentTickSize = tickSize;
    this.currentImbalanceThreshold = imbalanceThreshold;

    this.adapter = acquireAdapter(venue, symbol, marketType);
    if (!this.adapter) return;

    this.tradeListener = (trade: NormalizedTrade) => {
      this.onTrade(trade);
    };
    this.adapter.on("trade", this.tradeListener);

    this.bookListener = (book: NormalizedOrderBook) => {
      this.onOrderBook(book);
    };
    this.adapter.on("orderbook", this.bookListener);

    this.statusListener = (conn) => {
      this.pendingConnection = conn;
      this.scheduleFlush();
    };
    this.adapter.on("status", this.statusListener);

  }

  disconnect(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pendingTrades = [];
    this.pendingOrderBook = null;
    this.pendingCandle = null;
    this.pendingTicker = null;
    this.pendingOBI = null;
    this.pendingZScores = [];
    this.pendingConnection = null;
    if (this.adapter) {
      if (this.tradeListener) this.adapter.removeListener("trade", this.tradeListener);
      if (this.bookListener) this.adapter.removeListener("orderbook", this.bookListener);
      if (this.statusListener) this.adapter.removeListener("status", this.statusListener);
      if (this.currentVenue) {
        releaseAdapter(this.currentVenue, this.currentSymbol, this.currentMarketType);
      }
      this.adapter = null;
    }
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
          const vp = computeVolumeProfile(allCandles);
          store.setVolumeProfile(vp);
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

    // Compute OBI from top N levels
    const topN = 10;
    const bidVol = book.bids.slice(0, topN).reduce((s, l) => s + l.size, 0);
    const askVol = book.asks.slice(0, topN).reduce((s, l) => s + l.size, 0);
    const obi = computeOBI(bidVol, askVol);

    const snap: OBISnapshot = {
      timestamp: book.timestamp,
      value: obi,
      bidVolume: bidVol,
      askVolume: askVol,
    };
    this.pendingOrderBook = book;
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
      if (this.pendingTrades.length) {
        for (const trade of this.pendingTrades) store.pushTrade(trade);
        this.pendingTrades = [];
      }
      if (this.pendingOrderBook) {
        store.updateOrderBook(this.pendingOrderBook);
        this.pendingOrderBook = null;
      }
      if (this.pendingCandle) {
        store.updateCurrentCandle(this.pendingCandle);
        this.pendingCandle = null;
      }
      if (this.pendingTicker) {
        store.updateTicker(this.pendingTicker);
        this.pendingTicker = null;
      }
      if (this.pendingOBI) {
        store.pushOBI(this.pendingOBI);
        this.pendingOBI = null;
      }
      for (const point of this.pendingZScores) store.pushZScore(point);
      this.pendingZScores = [];
      if (this.pendingConnection) {
        store.updateConnection(this.pendingConnection);
        this.pendingConnection = null;
      }
    }, 50);
  }
}

export const marketDataManager = new MarketDataManager(useTerminalStore);
