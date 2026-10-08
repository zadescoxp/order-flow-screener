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

export class BinanceFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-futures";
  private readonly BASE_WS = "wss://fstream.binance.com/ws";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) { super(symbol.toUpperCase()); }
  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.startPingInterval();
      const s = this.symbol.toLowerCase();
      this.ws!.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${s}@depth50`, `${s}@trade`], id: 1 }));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { this.handleMessage(JSON.parse(event.data as string)); } catch { /**/ }
    };

    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => {
      this.stopPingInterval();
      if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); }
    };
  }

  disconnect(): void {
    this.setStatus("offline");
    this.stopPingInterval();
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as any;
    if (msg.e === "trade") {
      const price = parseFloat(msg.p), qty = parseFloat(msg.q);
      this.emitTrade({ id: `bf-${msg.t}`, venue: this.venue, symbol: msg.s, timestamp: msg.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: msg.m ? "sell" : "buy", marketType: "perpetual", sequence: msg.t });
    } else if (msg.lastUpdateId && msg.bids && msg.asks) {
      this.bids.clear(); this.asks.clear();
      for (const [p, q] of msg.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
      for (const [p, q] of msg.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
      this.emitBook();
    }
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
    const book: NormalizedOrderBook = { venue: this.venue, symbol: this.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks };
    this.emitOrderBook(book);
  }

  protected sendPing(): void { if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) this.setStatus("stale"); }
  private startPingInterval(): void { this.pingInterval = setInterval(() => this.sendPing(), 10_000); }
  private stopPingInterval(): void { if (this.pingInterval) clearInterval(this.pingInterval); this.pingInterval = null; }
}
