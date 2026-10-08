// ============================================================
// MARKET DATA MANAGER
// Manages adapter lifecycle, feeds data into order-flow engine
// and dispatches normalized events to the Zustand store
// ============================================================

"use client";

import { BinanceFuturesAdapter } from "@/lib/adapters/binanceFutures";
import { BybitFuturesAdapter, OKXFuturesAdapter, BinanceSpotAdapter, HyperliquidAdapter } from "@/lib/adapters/exchanges";
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

class MarketDataManager {
  private adapter: BaseExchangeAdapter | null = null;
  private currentSymbol = "";
  private currentVenue: Venue | null = null;
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

  subscribe(
    venue: Venue,
    symbol: string,
    marketType: MarketType,
    timeframe: Timeframe,
    tickSize: number,
    imbalanceThreshold: number
  ): void {
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
    this.currentTimeframe = timeframe;
    this.currentTickSize = tickSize;
    this.currentImbalanceThreshold = imbalanceThreshold;

    this.adapter = this.createAdapter(venue, symbol, marketType);
    if (!this.adapter) return;

    this.adapter.on("trade", (trade: NormalizedTrade) => {
      this.onTrade(trade);
    });

    this.adapter.on("orderbook", (book: NormalizedOrderBook) => {
      this.onOrderBook(book);
    });

    this.adapter.on("status", (conn) => {
      useTerminalStore.getState().updateConnection(conn);
    });

    this.adapter.connect();
  }

  disconnect(): void {
    if (this.adapter) {
      this.adapter.disconnect();
      this.adapter.removeAllListeners();
      this.adapter = null;
    }
    this.currentCandleRef = null;
    this.allLevels = [];
    this.volumeWindow = [];
    this.cumulativeDelta = 0;
    useTerminalStore.getState().resetMarketData();
  }

  private createAdapter(
    venue: Venue,
    symbol: string,
    _marketType: MarketType
  ): BaseExchangeAdapter | null {
    switch (venue) {
      case "binance-futures":
        return new BinanceFuturesAdapter(symbol);
      case "bybit-futures":
        return new BybitFuturesAdapter(symbol);
      case "okx-futures":
        return new OKXFuturesAdapter(this.toOKXSymbol(symbol, "perpetual"));
      case "binance-spot":
        return new BinanceSpotAdapter(symbol);
      case "hyperliquid":
        return new HyperliquidAdapter(symbol.replace("USDT", ""));
      default:
        return null;
    }
  }

  private toOKXSymbol(symbol: string, type: "perpetual" | "spot"): string {
    // BTCUSDT → BTC-USDT-SWAP
    const base = symbol.replace("USDT", "").replace("USD", "");
    if (type === "perpetual") return `${base}-USDT-SWAP`;
    return `${base}-USDT`;
  }

  private onTrade(trade: NormalizedTrade): void {
    const store = useTerminalStore.getState();
    store.pushTrade(trade);

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
    store.updateCurrentCandle({ ...this.currentCandleRef });

    // Update ticker
    store.updateTicker({
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
    });

    // Z-score on volume
    this.volumeWindow.push(trade.quantity);
    if (this.volumeWindow.length > 200) this.volumeWindow.shift();
    const zScore = computeZScore(this.volumeWindow, trade.quantity);
    const zPoint: ZScorePoint = {
      timestamp: trade.timestamp,
      value: zScore,
      volume: trade.quantity,
    };
    store.pushZScore(zPoint);
  }

  private onOrderBook(book: NormalizedOrderBook): void {
    const store = useTerminalStore.getState();
    store.updateOrderBook(book);

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
    store.pushOBI(snap);
  }
}

// Singleton instance
export const marketDataManager = new MarketDataManager();
