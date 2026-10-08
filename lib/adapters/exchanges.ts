// ============================================================
// BYBIT FUTURES ADAPTER
// Connects to Bybit V5 WebSocket streams
// ============================================================

import { BaseExchangeAdapter } from "./base";
import type {
  NormalizedTrade,
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";

interface BybitTradeItem {
  T: number; // timestamp ms
  s: string; // symbol
  S: "Buy" | "Sell"; // side
  v: string; // size
  p: string; // price
  i: string; // trade id
  BT: boolean; // block trade
}

interface BybitDepthData {
  s: string;
  b: [string, string][];
  a: [string, string][];
  u: number;
  seq: number;
}

export class BybitFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "bybit-futures";
  private readonly BASE_WS = "wss://stream.bybit.com/v5/public/linear";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastSeq = 0;

  constructor(symbol: string) {
    super(symbol.toUpperCase());
  }

  protected buildWsUrl(): string {
    return this.BASE_WS;
  }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");

      // Subscribe to trade and orderbook streams
      const sym = this.symbol;
      const sub = {
        op: "subscribe",
        args: [`publicTrade.${sym}`, `orderbook.50.${sym}`],
      };
      this.ws!.send(JSON.stringify(sub));
      this.startPingInterval();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.op === "pong") return;
        if (msg.topic) this.handleMessage(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onerror = () => this.setStatus("error");
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
    this.ws?.close();
    this.ws = null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { topic: string; type: string; data: unknown; ts: number };
    if (msg.topic.startsWith("publicTrade.")) {
      const trades = msg.data as BybitTradeItem[];
      for (const t of trades) this.handleTrade(t);
    } else if (msg.topic.startsWith("orderbook.")) {
      this.handleOrderBook(msg.type, msg.data as BybitDepthData);
    }
  }

  private handleTrade(t: BybitTradeItem): void {
    const price = parseFloat(t.p);
    const qty = parseFloat(t.v);

    const trade: NormalizedTrade = {
      id: `bb-${t.i}`,
      venue: this.venue,
      symbol: t.s,
      timestamp: t.T,
      localTimestamp: Date.now(),
      price,
      quantity: qty,
      quoteVolume: price * qty,
      side: t.S === "Buy" ? "buy" : "sell",
      marketType: "perpetual",
      sequence: undefined,
    };
    this.emitTrade(trade);
  }

  private handleOrderBook(type: string, data: BybitDepthData): void {
    if (type === "snapshot") {
      this.bids.clear();
      this.asks.clear();
    }

    for (const [p, q] of data.b) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.bids.delete(price);
      else this.bids.set(price, qty);
    }
    for (const [p, q] of data.a) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.asks.delete(price);
      else this.asks.set(price, qty);
    }

    this.lastSeq = data.seq;
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

    this.emitOrderBook({
      venue: this.venue,
      symbol: this.symbol,
      timestamp: Date.now(),
      localTimestamp: Date.now(),
      bids,
      asks,
      sequence: this.lastSeq,
    });
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: "ping" }));
    }
    if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) {
      this.setStatus("stale");
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => this.sendPing(), 20_000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }
}

// ============================================================
// OKX FUTURES ADAPTER
// ============================================================

export class OKXFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "okx-futures";
  private readonly BASE_WS = "wss://ws.okx.com:8443/ws/v5/public";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    // OKX uses format like BTC-USDT-SWAP for perpetuals
    let okxSym = symbol.toUpperCase();
    if (okxSym.endsWith("USDT")) okxSym = okxSym.replace("USDT", "-USDT-SWAP");
    super(okxSym);
  }

  protected buildWsUrl(): string {
    return this.BASE_WS;
  }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");

      const sub = {
        op: "subscribe",
        args: [
          { channel: "trades", instId: this.symbol },
          { channel: "books50-l2-tbt", instId: this.symbol },
        ],
      };
      this.ws!.send(JSON.stringify(sub));
      this.startPingInterval();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.event === "pong") return;
        if (msg.arg && msg.data) this.handleMessage(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onerror = () => this.setStatus("error");
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
    this.ws?.close();
    this.ws = null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as {
      arg: { channel: string };
      action?: string;
      data: unknown[];
    };

    if (msg.arg.channel === "trades") {
      for (const t of msg.data as Array<{
        tradeId: string; instId: string; px: string; sz: string;
        side: "buy" | "sell"; ts: string;
      }>) {
        const price = parseFloat(t.px);
        const qty = parseFloat(t.sz);
        this.emitTrade({
          id: `okx-${t.tradeId}`,
          venue: this.venue,
          symbol: t.instId,
          timestamp: parseInt(t.ts),
          localTimestamp: Date.now(),
          price,
          quantity: qty,
          quoteVolume: price * qty,
          side: t.side,
          marketType: "perpetual",
        });
      }
    } else if (msg.arg.channel === "books50-l2-tbt") {
      for (const d of msg.data as Array<{
        bids: [string, string, string, string][];
        asks: [string, string, string, string][];
        ts: string;
        seqId: number;
        action?: string;
      }>) {
        if (msg.action === "snapshot") {
          this.bids.clear();
          this.asks.clear();
        }
        for (const [p, q] of d.bids) {
          const price = parseFloat(p);
          const qty = parseFloat(q);
          if (qty === 0) this.bids.delete(price);
          else this.bids.set(price, qty);
        }
        for (const [p, q] of d.asks) {
          const price = parseFloat(p);
          const qty = parseFloat(q);
          if (qty === 0) this.asks.delete(price);
          else this.asks.set(price, qty);
        }

        const bids = [...this.bids.entries()]
          .sort((a, b) => b[0] - a[0])
          .slice(0, 50)
          .map(([price, size]) => ({ price, size, venue: this.venue }));
        const asks = [...this.asks.entries()]
          .sort((a, b) => a[0] - b[0])
          .slice(0, 50)
          .map(([price, size]) => ({ price, size, venue: this.venue }));

        this.emitOrderBook({
          venue: this.venue,
          symbol: this.symbol,
          timestamp: parseInt(d.ts),
          localTimestamp: Date.now(),
          bids,
          asks,
        });
      }
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send("ping");
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => this.sendPing(), 25_000);
  }
  private stopPingInterval(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
  }
}

// ============================================================
// BINANCE SPOT ADAPTER
// ============================================================
export class BinanceSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-spot";
  private readonly BASE_WS = "wss://stream.binance.com:9443/stream";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastUpdateId = 0;
  private snapshotLoaded = false;
  private pendingUpdates: Array<{
    U: number; u: number;
    b: [string, string][]; a: [string, string][];
  }> = [];

  constructor(symbol: string) {
    super(symbol.toUpperCase());
  }

  protected buildWsUrl(): string {
    const sym = this.symbol.toLowerCase();
    return `${this.BASE_WS}?streams=${sym}@aggTrade/${sym}@depth@100ms`;
  }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.startPingInterval();
      this.loadSnapshot();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.stream && msg.data) this.handleMessage(msg.data);
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => this.setStatus("error");
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
    this.ws?.close();
    this.ws = null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { e: string };
    if (msg.e === "aggTrade") {
      const t = raw as { a: number; T: number; s: string; p: string; q: string; m: boolean };
      const price = parseFloat(t.p);
      const qty = parseFloat(t.q);
      this.emitTrade({
        id: `bs-${t.a}`,
        venue: this.venue,
        symbol: t.s,
        timestamp: t.T,
        localTimestamp: Date.now(),
        price,
        quantity: qty,
        quoteVolume: price * qty,
        side: t.m ? "sell" : "buy",
        marketType: "spot",
        sequence: t.a,
      });
    } else if (msg.e === "depthUpdate") {
      const d = raw as {
        U: number; u: number;
        b: [string, string][]; a: [string, string][];
      };
      if (!this.snapshotLoaded) {
        this.pendingUpdates.push(d);
        return;
      }
      this.applyDepth(d);
    }
  }

  private applyDepth(d: { U: number; u: number; b: [string, string][]; a: [string, string][] }): void {
    for (const [p, q] of d.b) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.bids.delete(price);
      else this.bids.set(price, qty);
    }
    for (const [p, q] of d.a) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty === 0) this.asks.delete(price);
      else this.asks.set(price, qty);
    }
    this.lastUpdateId = d.u;
    this.emitBook();
  }

  private emitBook(): void {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
    this.emitOrderBook({ venue: this.venue, symbol: this.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks });
  }

  private async loadSnapshot(): Promise<void> {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${this.symbol}&limit=1000`);
      const data = await res.json() as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
      this.bids.clear();
      this.asks.clear();
      for (const [p, q] of data.bids) { const price = parseFloat(p); const qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
      for (const [p, q] of data.asks) { const price = parseFloat(p); const qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
      this.lastUpdateId = data.lastUpdateId;
      this.snapshotLoaded = true;
      for (const u of this.pendingUpdates) { if (u.u > this.lastUpdateId) this.applyDepth(u); }
      this.pendingUpdates = [];
      this.emitBook();
    } catch { setTimeout(() => this.loadSnapshot(), 5000); }
  }

  protected sendPing(): void {
    if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) this.setStatus("stale");
  }

  private startPingInterval(): void { this.pingInterval = setInterval(() => this.sendPing(), 10_000); }
  private stopPingInterval(): void { if (this.pingInterval) clearInterval(this.pingInterval); this.pingInterval = null; }
}

// ============================================================
// HYPERLIQUID ADAPTER
// ============================================================
export class HyperliquidAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "hyperliquid";
  private readonly BASE_WS = "wss://api.hyperliquid.xyz/ws";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    let hlSym = symbol.toUpperCase();
    if (hlSym.endsWith("USDT")) hlSym = hlSym.replace("USDT", "");
    super(hlSym);
  }

  protected buildWsUrl(): string {
    return this.BASE_WS;
  }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");

      this.ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: this.symbol } }));
      this.ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: this.symbol } }));
      this.startPingInterval();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => this.setStatus("error");
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
    this.ws?.close();
    this.ws = null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { channel: string; data: unknown };
    if (msg.channel === "trades") {
      const trades = msg.data as Array<{
        coin: string; side: "A" | "B"; px: string; sz: string;
        time: number; tid: number;
      }>;
      for (const t of trades) {
        const price = parseFloat(t.px);
        const qty = parseFloat(t.sz);
        // A = ask side (seller is aggressor = sell), B = bid side (buyer is aggressor = buy)
        this.emitTrade({
          id: `hl-${t.tid}`,
          venue: this.venue,
          symbol: t.coin,
          timestamp: t.time,
          localTimestamp: Date.now(),
          price,
          quantity: qty,
          quoteVolume: price * qty,
          side: t.side === "B" ? "buy" : "sell",
          marketType: "perpetual",
        });
      }
    } else if (msg.channel === "l2Book") {
      const book = msg.data as {
        coin: string; time: number;
        levels: [[string, string][], [string, string][]]; // [bids, asks]
      };
      this.bids.clear();
      this.asks.clear();
      for (const [p, q] of book.levels[0]) {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        if (qty > 0) this.bids.set(price, qty);
      }
      for (const [p, q] of book.levels[1]) {
        const price = parseFloat(p);
        const qty = parseFloat(q);
        if (qty > 0) this.asks.set(price, qty);
      }
      const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
      const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
      this.emitOrderBook({ venue: this.venue, symbol: this.symbol, timestamp: book.time, localTimestamp: Date.now(), bids, asks });
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: "ping" }));
    }
  }

  private startPingInterval(): void { this.pingInterval = setInterval(() => this.sendPing(), 20_000); }
  private stopPingInterval(): void { if (this.pingInterval) clearInterval(this.pingInterval); this.pingInterval = null; }
}

// ============================================================
// ADAPTER FACTORY
// ============================================================

export function createAdapter(
  venue: Venue,
  symbol: string
): BaseExchangeAdapter | null {
  switch (venue) {
    case "binance-futures": {
      const { BinanceFuturesAdapter } = require("./binanceFutures");
      return new BinanceFuturesAdapter(symbol) as BaseExchangeAdapter;
    }
    case "bybit-futures":
      return new BybitFuturesAdapter(symbol);
    case "okx-futures":
      return new OKXFuturesAdapter(symbol);
    case "binance-spot":
      return new BinanceSpotAdapter(symbol);
    case "hyperliquid":
      return new HyperliquidAdapter(symbol);
    case "coinbase-spot":
      return new CoinbaseSpotAdapter(symbol);
    default:
      return null;
  }
}

// ============================================================
// COINBASE SPOT ADAPTER
// ============================================================
export class CoinbaseSpotAdapter extends BaseExchangeAdapter {
  readonly venue = "coinbase-spot" as Venue;
  private readonly BASE_WS = "wss://ws-feed.exchange.coinbase.com";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    let cbSym = symbol.toUpperCase();
    if (cbSym.endsWith("USDT")) cbSym = cbSym.replace("USDT", "-USD");
    super(cbSym);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");

      const msg = {
        type: "subscribe",
        product_ids: [this.symbol],
        channels: ["level2", "matches"]
      };
      this.ws!.send(JSON.stringify(msg));
      this.startPingInterval();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch { /* ignore */ }
    };

    this.ws.onerror = () => this.setStatus("error");
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
    this.ws?.close();
    this.ws = null;
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as any;
    if (msg.type === "match") {
      const price = parseFloat(msg.price);
      const qty = parseFloat(msg.size);
      this.emitTrade({
        id: `cb-${msg.trade_id}`,
        venue: this.venue,
        symbol: msg.product_id,
        timestamp: new Date(msg.time).getTime(),
        localTimestamp: Date.now(),
        price,
        quantity: qty,
        quoteVolume: price * qty,
        side: msg.side === "buy" ? "buy" : "sell",
        marketType: "spot",
      });
    } else if (msg.type === "snapshot" || msg.type === "l2update") {
      if (msg.type === "snapshot") {
        this.bids.clear();
        this.asks.clear();
        for (const [p, q] of msg.bids) this.bids.set(parseFloat(p), parseFloat(q));
        for (const [p, q] of msg.asks) this.asks.set(parseFloat(p), parseFloat(q));
      } else {
        for (const [side, p, q] of msg.changes) {
          const price = parseFloat(p);
          const qty = parseFloat(q);
          if (side === "buy") {
            if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty);
          } else {
            if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty);
          }
        }
      }

      const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
      const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, 50).map(([price, size]) => ({ price, size, venue: this.venue }));
      this.emitOrderBook({ venue: this.venue, symbol: this.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks });
    }
  }

  protected sendPing(): void { }
  private startPingInterval(): void { this.pingInterval = setInterval(() => {}, 10000); }
  private stopPingInterval(): void { if (this.pingInterval) clearInterval(this.pingInterval); this.pingInterval = null; }
}
