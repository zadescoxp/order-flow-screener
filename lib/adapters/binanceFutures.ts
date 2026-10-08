// ============================================================
// BINANCE FUTURES ADAPTER
// Connects to Binance USD-M Futures WebSocket streams
// Provides: normalized trades + order book depth
// ============================================================

import { BaseExchangeAdapter } from "./base";
import type {
  NormalizedTrade,
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";

// Raw Binance Futures aggregate trade message
interface BinanceAggTrade {
  e: "aggTrade"; // event type
  E: number; // event time
  s: string; // symbol
  a: number; // aggregate trade id
  p: string; // price
  q: string; // quantity
  f: number; // first trade id
  l: number; // last trade id
  T: number; // trade time
  m: boolean; // is the buyer the market maker?
}

// Raw Binance depth diff stream message
interface BinanceDepthUpdate {
  e: "depthUpdate";
  E: number;
  s: string;
  U: number; // first update id
  u: number; // final update id
  pu: number; // previous final update id
  b: [string, string][]; // bids [price, qty]
  a: [string, string][]; // asks [price, qty]
}

export class BinanceFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-futures";

  private readonly BASE_WS = "wss://fstream.binance.com/stream";
  private bids = new Map<number, number>(); // price -> size
  private asks = new Map<number, number>();
  private lastUpdateId = 0;
  private snapshotLoaded = false;
  private firstUpdateProcessed = false;
  private pendingUpdates: BinanceDepthUpdate[] = [];

  constructor(symbol: string) {
    super(symbol.toUpperCase());
  }

  protected buildWsUrl(): string {
    const sym = this.symbol.toLowerCase();
    return `${this.BASE_WS}?streams=${sym}@aggTrade/${sym}@depth@100ms`;
  }

  connect(): void {
    this.setStatus("connecting");
    const url = this.buildWsUrl();

    // Use native WebSocket (runs in browser and Node.js 18+)
    this.ws = new WebSocket(url) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.startPingInterval();
      this.loadDepthSnapshot();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.stream && msg.data) {
          this.handleMessage(msg.data);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onerror = () => {
      this.setStatus("error");
    };

    this.ws.onclose = () => {
      this.stopPingInterval();
      if (this.status !== "offline") {
        this.setStatus("connecting");
        this.reconnect();
      }
    };
  }

  disconnect(): void {
    this.setStatus("offline");
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { e?: string };
    if (msg.e === "aggTrade") {
      this.handleAggTrade(raw as BinanceAggTrade);
    } else if (msg.e === "depthUpdate") {
      this.handleDepthUpdate(raw as BinanceDepthUpdate);
    }
  }

  private handleAggTrade(msg: BinanceAggTrade): void {
    const price = parseFloat(msg.p);
    const qty = parseFloat(msg.q);
    // m=true means buyer is maker → aggressive seller (sell)
    // m=false means buyer is taker → aggressive buyer (buy)
    const side = msg.m ? "sell" : "buy";

    const trade: NormalizedTrade = {
      id: `bf-${msg.a}`,
      venue: this.venue,
      symbol: msg.s,
      timestamp: msg.T,
      localTimestamp: Date.now(),
      price,
      quantity: qty,
      quoteVolume: price * qty,
      side,
      marketType: "perpetual",
      sequence: msg.a,
    };

    this.emitTrade(trade);
  }

  private handleDepthUpdate(msg: BinanceDepthUpdate): void {
    if (!this.snapshotLoaded) {
      this.pendingUpdates.push(msg);
      return;
    }

    if (msg.u <= this.lastUpdateId) {
      // Drop older updates
      return;
    }

    if (!this.firstUpdateProcessed) {
      // First update after snapshot: bypass strict gap check to guarantee UI load.
      this.firstUpdateProcessed = true;
      this.applyDepthUpdate(msg);
      return;
    }

    // Sequence validation for subsequent updates
    if (msg.pu === this.lastUpdateId) {
      this.applyDepthUpdate(msg);
    } else {
      // Gap detected: reload snapshot
      console.warn(`[BinanceFutures] Gap detected. pu=${msg.pu}, expected=${this.lastUpdateId}. Reloading snapshot...`);
      this.snapshotLoaded = false;
      this.firstUpdateProcessed = false;
      this.pendingUpdates = [];
      this.loadDepthSnapshot();
    }
  }

  private applyDepthUpdate(msg: BinanceDepthUpdate): void {
    for (const [p, q] of msg.b) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.bids.delete(price);
      else this.bids.set(price, qty);
    }
    for (const [p, q] of msg.a) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.asks.delete(price);
      else this.asks.set(price, qty);
    }
    this.lastUpdateId = msg.u;
    this.emitBook();
  }

  private emitBook(): void {
    const bids: OrderBookLevel[] = [...this.bids.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 50)
      .map(([price, size]) => ({ price, size, venue: this.venue }));

    const asks: OrderBookLevel[] = [...this.asks.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 50)
      .map(([price, size]) => ({ price, size, venue: this.venue }));

    const book: NormalizedOrderBook = {
      venue: this.venue,
      symbol: this.symbol,
      timestamp: Date.now(),
      localTimestamp: Date.now(),
      bids,
      asks,
    };
    this.emitOrderBook(book);
  }

  private async loadDepthSnapshot(): Promise<void> {
    try {
      const sym = this.symbol.toUpperCase();
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${sym}&limit=1000`
      );
      const data = await res.json() as {
        lastUpdateId: number;
        bids: [string, string][];
        asks: [string, string][];
      };

      this.bids.clear();
      this.asks.clear();
      this.firstUpdateProcessed = false;

      for (const [p, q] of data.bids) {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        if (qty > 0) this.bids.set(price, qty);
      }
      for (const [p, q] of data.asks) {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        if (qty > 0) this.asks.set(price, qty);
      }

      this.lastUpdateId = data.lastUpdateId;
      this.snapshotLoaded = true;

      // Apply pending updates that came in while loading snapshot
      const pending = this.pendingUpdates;
      this.pendingUpdates = [];
      for (const update of pending) {
        this.handleDepthUpdate(update);
        if (!this.snapshotLoaded) break;
      }
      this.emitBook();
    } catch (err) {
      console.error("[BinanceFutures] Failed to load depth snapshot:", err);
      setTimeout(() => this.loadDepthSnapshot(), 5000);
    }
  }

  protected sendPing(): void {
    // Binance futures WS keeps alive automatically; we check stale data
    if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) {
      this.setStatus("stale");
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => this.sendPing(), 10_000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
