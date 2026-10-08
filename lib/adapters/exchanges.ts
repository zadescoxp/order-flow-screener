// ============================================================
// EXCHANGE ADAPTERS — All venues
// ============================================================

import { BaseExchangeAdapter } from "./base";
import type {
  NormalizedTrade,
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";

// ─── Helpers ─────────────────────────────────────────────────
function emitBook(
  adapter: BaseExchangeAdapter & { venue: Venue; symbol: string },
  bidsMap: Map<number, number>,
  asksMap: Map<number, number>,
  emitFn: (book: NormalizedOrderBook) => void
) {
  const bids: OrderBookLevel[] = [...bidsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 50)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  const asks: OrderBookLevel[] = [...asksMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 50)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  emitFn({ venue: adapter.venue, symbol: adapter.symbol, timestamp: Date.now(), localTimestamp: Date.now(), bids, asks });
}

// ============================================================
// BYBIT FUTURES ADAPTER
// ============================================================
interface BybitTradeItem {
  T: number; S: "Buy" | "Sell"; v: string; p: string; i: string; s: string;
}
interface BybitDepthData {
  s: string; b: [string, string][]; a: [string, string][]; u: number; seq: number;
}

export class BybitFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "bybit-futures";
  private readonly BASE_WS = "wss://stream.bybit.com/v5/public/linear";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastSeq = 0;

  constructor(symbol: string) { super(symbol.toUpperCase()); }
  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${this.symbol}`, `orderbook.50.${this.symbol}`] }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { const m = JSON.parse(e.data as string); if (m.op === "pong") return; if (m.topic) this.handleMessage(m); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { topic: string; type: string; data: unknown };
    if (msg.topic.startsWith("publicTrade.")) {
      for (const t of msg.data as BybitTradeItem[]) {
        const price = parseFloat(t.p), qty = parseFloat(t.v);
        this.emitTrade({ id: `bb-${t.i}`, venue: this.venue, symbol: t.s, timestamp: t.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.S === "Buy" ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.topic.startsWith("orderbook.")) {
      const data = msg.data as BybitDepthData;
      if (msg.type === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const [p, q] of data.b) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
      for (const [p, q] of data.a) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      this.lastSeq = data.seq;
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: "ping" }));
    if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) this.setStatus("stale");
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// BYBIT SPOT ADAPTER
// ============================================================
export class BybitSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "bybit-spot";
  private readonly BASE_WS = "wss://stream.bybit.com/v5/public/spot";
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${this.symbol}`, `orderbook.50.${this.symbol}`] }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { const m = JSON.parse(e.data as string); if (m.op === "pong") return; if (m.topic) this.handleMessage(m); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { topic: string; type: string; data: unknown };
    if (msg.topic.startsWith("publicTrade.")) {
      for (const t of msg.data as BybitTradeItem[]) {
        const price = parseFloat(t.p), qty = parseFloat(t.v);
        this.emitTrade({ id: `bbs-${t.i}`, venue: this.venue, symbol: t.s, timestamp: t.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.S === "Buy" ? "buy" : "sell", marketType: "spot" });
      }
    } else if (msg.topic.startsWith("orderbook.")) {
      const data = msg.data as BybitDepthData;
      if (msg.type === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const [p, q] of data.b) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
      for (const [p, q] of data.a) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: "ping" }));
    if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) this.setStatus("stale");
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
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
    // Accept BTCUSDT or BTC-USDT-SWAP — normalize to BTC-USDT-SWAP
    let s = symbol.toUpperCase();
    if (!s.includes("-")) {
      const base = s.replace("USDT", "").replace("USD", "");
      s = `${base}-USDT-SWAP`;
    }
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: this.symbol }, { channel: "books5", instId: this.symbol }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.arg && m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    if (msg.arg.channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz);
        this.emitTrade({ id: `okx-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "perpetual" });
      }
    } else if (msg.arg.channel === "books5") {
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        this.bids.clear(); this.asks.clear();
        for (const [p, q] of d.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
        for (const [p, q] of d.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
        emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
      }
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// OKX SPOT ADAPTER
// ============================================================
export class OKXSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "okx-spot";
  private readonly BASE_WS = "wss://ws.okx.com:8443/ws/v5/public";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    let s = symbol.toUpperCase();
    if (!s.includes("-")) {
      const base = s.replace("USDT", "").replace("USD", "");
      s = `${base}-USDT`;
    }
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: this.symbol }, { channel: "books5", instId: this.symbol }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.arg && m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    if (msg.arg.channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz);
        this.emitTrade({ id: `okxs-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "spot" });
      }
    } else if (msg.arg.channel === "books5") {
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        this.bids.clear(); this.asks.clear();
        for (const [p, q] of d.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
        for (const [p, q] of d.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
        emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
      }
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// BINANCE SPOT ADAPTER
// ============================================================
export class BinanceSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-spot";
  private readonly BASE_WS = "wss://stream.binance.com:9443/ws";
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
      this.startPing(10_000);
      const s = this.symbol.toLowerCase();
      this.ws!.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${s}@depth50`, `${s}@trade`], id: 1 }));
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { this.handleMessage(JSON.parse(e.data as string)); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as any;
    if (msg.e === "trade") {
      const price = parseFloat(msg.p), qty = parseFloat(msg.q);
      this.emitTrade({ id: `bs-${msg.t}`, venue: this.venue, symbol: msg.s, timestamp: msg.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: msg.m ? "sell" : "buy", marketType: "spot", sequence: msg.t });
    } else if (msg.lastUpdateId && msg.bids && msg.asks) {
      this.bids.clear(); this.asks.clear();
      for (const [p, q] of msg.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
      for (const [p, q] of msg.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (Date.now() - this.lastHeartbeat > this.staleThresholdMs) this.setStatus("stale"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
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
    // Accept BTCUSDT or BTC — normalize to BTC
    let s = symbol.toUpperCase();
    if (s.endsWith("USDT")) s = s.replace("USDT", "");
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      this.ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: this.symbol } }));
      this.ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: this.symbol } }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { this.handleMessage(JSON.parse(e.data as string)); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { channel: string; data: unknown };
    if (msg.channel === "trades") {
      for (const t of msg.data as Array<{ coin: string; side: "A" | "B"; px: string; sz: string; time: number; tid: number }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz);
        this.emitTrade({ id: `hl-${t.tid}`, venue: this.venue, symbol: t.coin, timestamp: t.time, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side === "B" ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.channel === "l2Book") {
      const book = msg.data as { coin: string; time: number; levels: [[string, string][], [string, string][]] };
      this.bids.clear(); this.asks.clear();
      for (const [p, q] of book.levels[0]) { const pr = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(pr, qty); }
      for (const [p, q] of book.levels[1]) { const pr = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(pr, qty); }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ method: "ping" })); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// BITGET FUTURES ADAPTER (mix-contracts)
// ============================================================
export class BitgetFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "bitget-futures";
  private readonly BASE_WS = "wss://ws.bitget.com/v2/ws/public";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    let s = symbol.toUpperCase();
    if (s.includes("_UMCBL")) s = s.replace("_UMCBL", "");
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      const instType = "USDT-FUTURES";
      const instId = this.symbol;
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ instType, channel: "trade", instId }, { instType, channel: "books", instId }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    if (msg.arg.channel === "trade") {
      for (const t of msg.data as Array<[string, string, string, string, string]>) {
        // [timestamp, price, qty, side, tradeId]
        const [ts, px, sz, side] = t;
        const price = parseFloat(px), qty = parseFloat(sz);
        this.emitTrade({ id: `bg-${ts}`, venue: this.venue, symbol: this.symbol, timestamp: parseInt(ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: side === "buy" ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.arg.channel === "books") {
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string][]; asks: [string, string][] }>) {
        for (const [p, q] of d.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
        for (const [p, q] of d.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// BITGET SPOT ADAPTER
// ============================================================
export class BitgetSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "bitget-spot";
  private readonly BASE_WS = "wss://ws.bitget.com/v2/ws/public";
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "trade", instId: this.symbol }, { instType: "SPOT", channel: "books", instId: this.symbol }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try {
        const raw = e.data as string;
        if (raw === "pong") return;
        const m = JSON.parse(raw);
        if (m.data) this.handleMessage(m);
      } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { arg: { channel: string }; action?: string; data: unknown[] };
    if (msg.arg.channel === "trade") {
      for (const t of msg.data as Array<[string, string, string, string, string]>) {
        const [ts, px, sz, side] = t;
        const price = parseFloat(px), qty = parseFloat(sz);
        this.emitTrade({ id: `bgs-${ts}`, venue: this.venue, symbol: this.symbol, timestamp: parseInt(ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: side === "buy" ? "buy" : "sell", marketType: "spot" });
      }
    } else if (msg.arg.channel === "books") {
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string][]; asks: [string, string][] }>) {
        for (const [p, q] of d.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
        for (const [p, q] of d.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// COINBASE SPOT ADAPTER
// ============================================================
export class CoinbaseSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "coinbase-spot";
  private readonly BASE_WS = "wss://advanced-trade-ws.coinbase.com";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();

  constructor(symbol: string) {
    // BTCUSDT → BTC-USD
    let s = symbol.toUpperCase();
    if (!s.includes("-")) {
      const base = s.replace("USDT", "").replace("USD", "");
      s = `${base}-USD`;
    }
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      // Coinbase Advanced Trade API uses channel-based subscription
      this.ws!.send(JSON.stringify({ type: "subscribe", product_ids: [this.symbol], channel: "market_trades" }));
      this.ws!.send(JSON.stringify({ type: "subscribe", product_ids: [this.symbol], channel: "level2" }));
      this.startPing(30_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { this.handleMessage(JSON.parse(e.data as string)); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const channel = msg.channel as string;

    if (channel === "market_trades") {
      for (const t of (msg.events ?? []) as Array<{ trades: Array<{ trade_id: string; product_id: string; price: string; size: string; side: string; time: string }> }>) {
        for (const tr of t.trades ?? []) {
          const price = parseFloat(tr.price), qty = parseFloat(tr.size);
          this.emitTrade({ id: `cb-${tr.trade_id}`, venue: this.venue, symbol: tr.product_id, timestamp: new Date(tr.time).getTime(), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: tr.side === "BUY" ? "buy" : "sell", marketType: "spot" });
        }
      }
    } else if (channel === "l2_data") {
      for (const event of (msg.events ?? []) as Array<{ type: string; updates: Array<{ side: string; price_level: string; new_quantity: string }> }>) {
        if (event.type === "snapshot") { this.bids.clear(); this.asks.clear(); }
        for (const u of event.updates ?? []) {
          const price = parseFloat(u.price_level), qty = parseFloat(u.new_quantity);
          if (u.side === "bid") { if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
          else { if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
        }
        emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
      }
    }
  }

  protected sendPing(): void { /* Coinbase pings via heartbeat subscription */ }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// DERIBIT ADAPTER (BTC/ETH perpetuals)
// ============================================================
export class DeribitAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "deribit";
  private readonly BASE_WS = "wss://www.deribit.com/ws/api/v2";
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private reqId = 1;

  constructor(symbol: string) {
    // BTCUSDT → BTC-PERPETUAL
    let s = symbol.toUpperCase();
    const base = s.replace("USDT", "").replace("USD", "");
    s = `${base}-PERPETUAL`;
    super(s);
  }

  protected buildWsUrl(): string { return this.BASE_WS; }

  connect(): void {
    this.setStatus("connecting");
    this.ws = new WebSocket(this.buildWsUrl()) as unknown as WebSocket;
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      // Subscribe to trades
      this.send({ jsonrpc: "2.0", id: this.reqId++, method: "public/subscribe", params: { channels: [`trades.${this.symbol}.100ms`, `book.${this.symbol}.none.20.100ms`] } });
      this.startPing(15_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      try { this.handleMessage(JSON.parse(e.data as string)); } catch { /**/ }
    };
    this.ws.onerror = () => this.setStatus("error");
    this.ws.onclose = () => { this.stopPing(); if (this.status !== "offline") { this.setStatus("connecting"); this.reconnect(); } };
  }

  disconnect(): void { this.setStatus("offline"); this.stopPing(); this.ws?.close(); this.ws = null; }

  private send(obj: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { method?: string; params?: { channel: string; data: unknown } };
    if (msg.method !== "subscription" || !msg.params) return;
    const { channel, data } = msg.params;

    if (channel.startsWith("trades.")) {
      for (const t of data as Array<{ trade_id: string; instrument_name: string; price: number; amount: number; direction: "buy" | "sell"; timestamp: number }>) {
        this.emitTrade({ id: `db-${t.trade_id}`, venue: this.venue, symbol: t.instrument_name, timestamp: t.timestamp, localTimestamp: Date.now(), price: t.price, quantity: t.amount, quoteVolume: t.price * t.amount, side: t.direction, marketType: "perpetual" });
      }
    } else if (channel.startsWith("book.")) {
      const d = data as { type: "snapshot" | "change"; bids: [string, number, number][]; asks: [string, number, number][] };
      if (d.type === "snapshot") { this.bids.clear(); this.asks.clear(); }
      // Deribit book format: ["new"|"change"|"delete", price, amount]
      for (const [action, price, amount] of d.bids) {
        if (action === "delete" || amount === 0) this.bids.delete(price); else this.bids.set(price, amount);
      }
      for (const [action, price, amount] of d.asks) {
        if (action === "delete" || amount === 0) this.asks.delete(price); else this.asks.set(price, amount);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void {
    this.send({ jsonrpc: "2.0", id: this.reqId++, method: "public/test", params: {} });
  }
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startPing(ms: number) { this.pingTimer = setInterval(() => this.sendPing(), ms); }
  private stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }
}

// ============================================================
// ADAPTER FACTORY
// ============================================================
export function createAdapter(venue: Venue, symbol: string): BaseExchangeAdapter | null {
  switch (venue) {
    case "binance-futures": {
      const { BinanceFuturesAdapter } = require("./binanceFutures");
      return new BinanceFuturesAdapter(symbol) as BaseExchangeAdapter;
    }
    case "bybit-futures":   return new BybitFuturesAdapter(symbol);
    case "bybit-spot":      return new BybitSpotAdapter(symbol);
    case "okx-futures":     return new OKXFuturesAdapter(symbol);
    case "okx-spot":        return new OKXSpotAdapter(symbol);
    case "binance-spot":    return new BinanceSpotAdapter(symbol);
    case "hyperliquid":     return new HyperliquidAdapter(symbol);
    case "bitget-futures":  return new BitgetFuturesAdapter(symbol);
    case "bitget-spot":     return new BitgetSpotAdapter(symbol);
    case "coinbase-spot":   return new CoinbaseSpotAdapter(symbol);
    case "deribit":         return new DeribitAdapter(symbol);
    default:                return null;
  }
}
