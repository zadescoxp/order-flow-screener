// ============================================================
// EXCHANGE ADAPTERS — All venues
// ============================================================

import { BaseExchangeAdapter, num } from "./base";
import type {
  NormalizedTrade,
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
  LiquidationSide,
} from "@/lib/types/market";
import { FinnhubForexAdapter } from "./forex";

// ─── Helpers ─────────────────────────────────────────────────
type DeribitLevel = [number, number] | [string, number, number];

/** Apply [price, size, ...] deltas to a book side; a size of 0 removes the level. */
function applyLevels(side: Map<number, number>, levels: ReadonlyArray<ReadonlyArray<string>>, multiplier: number) {
  for (const level of levels) {
    const price = parseFloat(level[0]);
    const qty = parseFloat(level[1]) * multiplier;
    if (!Number.isFinite(price)) continue;
    if (!(qty > 0)) side.delete(price);
    else side.set(price, qty);
  }
}
/** Bitget v2 trades are objects; older payloads were [ts, price, size, side, tradeId] arrays. */
function parseBitgetTrades(data: unknown[]): { ts: string; price: string; size: string; side: string; tradeId: string }[] {
  return data.map((t) => {
    if (Array.isArray(t)) {
      const [ts, price, size, side, tradeId] = t as string[];
      return { ts, price, size, side, tradeId: tradeId ?? ts };
    }
    const o = t as { ts: string; price: string; size: string; side: string; tradeId?: string };
    return { ...o, tradeId: o.tradeId ?? o.ts };
  });
}

/** Levels kept per side. Deep enough for the resting-liquidity heatmap. */
export const BOOK_DEPTH = 200;

function emitBook(
  adapter: BaseExchangeAdapter & { venue: Venue; symbol: string },
  bidsMap: Map<number, number>,
  asksMap: Map<number, number>,
  emitFn: (book: NormalizedOrderBook) => void
) {
  const bids: OrderBookLevel[] = [...bidsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, BOOK_DEPTH)
    .map(([price, size]) => ({ price, size, venue: adapter.venue }));
  const asks: OrderBookLevel[] = [...asksMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, BOOK_DEPTH)
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${this.symbol}`, `orderbook.1000.${this.symbol}`, `tickers.${this.symbol}`, `allLiquidation.${this.symbol}`] }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      if (msg.type === "snapshot") { this.bids.clear(); this.asks.clear(); this.lastSeq = 0; }
      if (msg.type === "delta" && this.lastSeq > 0 && data.u > this.lastSeq + 1) {
        this.bids.clear();
        this.asks.clear();
        this.requestResubscribe();
        return;
      }
      for (const [p, q] of data.b) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
      for (const [p, q] of data.a) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      this.lastSeq = data.u;
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (msg.topic.startsWith("tickers.")) {
      // Snapshot first, then deltas carrying only the fields that changed.
      const t = msg.data as Record<string, string | undefined>;
      this.emitDerivatives({
        openInterest: num(t.openInterest),
        fundingRate: num(t.fundingRate),
        fundingIntervalHours: num(t.fundingIntervalHour),
        nextFundingTime: num(t.nextFundingTime),
        markPrice: num(t.markPrice),
        indexPrice: num(t.indexPrice),
      });
    } else if (msg.topic.startsWith("allLiquidation.")) {
      // S is the liquidated position side: Buy = long position liquidated.
      for (const l of msg.data as Array<{ T: number; s: string; S: "Buy" | "Sell"; v: string; p: string }>) {
        this.emitLiquidation({ id: `bbl-${l.s}-${l.T}-${l.S}-${l.v}`, symbol: l.s, timestamp: l.T, price: parseFloat(l.p), quantity: parseFloat(l.v), side: l.S === "Buy" ? "long" : "short" });
      }
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${this.symbol}`, `orderbook.200.${this.symbol}`] }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      if (msg.type === "snapshot") { this.bids.clear(); this.asks.clear(); this.lastSeq = 0; }
      if (msg.type === "delta" && this.lastSeq > 0 && data.u > this.lastSeq + 1) {
        this.bids.clear();
        this.asks.clear();
        this.requestResubscribe();
        return;
      }
      for (const [p, q] of data.b) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.bids.delete(price); else this.bids.set(price, qty); }
      for (const [p, q] of data.a) { const price = parseFloat(p), qty = parseFloat(q); if (qty === 0) this.asks.delete(price); else this.asks.set(price, qty); }
      this.lastSeq = data.u;
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
  private contractValue = 1;

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
    this.ws.onopen = async () => {
      this.reconnectAttempts = 0;
      this.lastHeartbeat = Date.now();
      this.setStatus("live");
      await this.loadContractValue();
      const instId = this.symbol;
      const indexId = instId.replace(/-SWAP$/, "");
      this.ws!.send(JSON.stringify({
        op: "subscribe",
        args: [
          { channel: "trades", instId },
          { channel: "books", instId },
          { channel: "open-interest", instId },
          { channel: "funding-rate", instId },
          { channel: "mark-price", instId },
          { channel: "index-tickers", instId: indexId },
          // Liquidations are only published for the whole instrument type.
          { channel: "liquidation-orders", instType: "SWAP" },
        ],
      }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
    const channel = msg.arg.channel;
    if (channel === "open-interest") {
      for (const d of msg.data as Array<{ oiCcy?: string; ts?: string }>) this.emitDerivatives({ openInterest: num(d.oiCcy), timestamp: num(d.ts) });
      return;
    }
    if (channel === "funding-rate") {
      for (const d of msg.data as Array<{ fundingRate?: string; fundingTime?: string; nextFundingTime?: string }>) {
        const next = num(d.fundingTime);
        const after = num(d.nextFundingTime);
        this.emitDerivatives({
          fundingRate: num(d.fundingRate),
          nextFundingTime: next,
          fundingIntervalHours: next && after && after > next ? (after - next) / 3_600_000 : undefined,
        });
      }
      return;
    }
    if (channel === "mark-price") {
      for (const d of msg.data as Array<{ markPx?: string }>) this.emitDerivatives({ markPrice: num(d.markPx) });
      return;
    }
    if (channel === "index-tickers") {
      for (const d of msg.data as Array<{ idxPx?: string }>) this.emitDerivatives({ indexPrice: num(d.idxPx) });
      return;
    }
    if (channel === "liquidation-orders") {
      for (const item of msg.data as Array<{ instId: string; details: Array<{ side: "buy" | "sell"; posSide: string; bkPx: string; sz: string; ts: string }> }>) {
        if (item.instId !== this.symbol) continue;
        for (const d of item.details ?? []) {
          // A forced sell (posSide long, or net mode) closes a long.
          const side = d.posSide === "long" || (d.posSide !== "short" && d.side === "sell") ? "long" : "short";
          this.emitLiquidation({ id: `okxl-${item.instId}-${d.ts}-${d.sz}`, symbol: item.instId, timestamp: parseInt(d.ts), price: parseFloat(d.bkPx), quantity: parseFloat(d.sz) * this.contractValue, side });
        }
      }
      return;
    }
    if (channel === "trades") {
      for (const t of msg.data as Array<{ tradeId: string; instId: string; px: string; sz: string; side: "buy" | "sell"; ts: string }>) {
        const price = parseFloat(t.px), qty = parseFloat(t.sz) * this.contractValue;
        this.emitTrade({ id: `okx-${t.tradeId}`, venue: this.venue, symbol: t.instId, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "perpetual" });
      }
    } else if (channel === "books") {
      // OKX sends one "snapshot" followed by incremental "update" messages;
      // a size of 0 removes the level.
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        applyLevels(this.bids, d.bids, this.contractValue);
        applyLevels(this.asks, d.asks, this.contractValue);
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }

  protected sendPing(): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping"); }
  private async loadContractValue(): Promise<void> {
    try {
      const response = await fetch(
        `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(this.symbol)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { data?: Array<{ ctVal?: string }> };
      const value = Number(body.data?.[0]?.ctVal);
      if (Number.isFinite(value) && value > 0) this.contractValue = value;
    } catch (error) {
      this.reportError(
        `Unable to load OKX contract value: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: this.symbol }, { channel: "books", instId: this.symbol }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
    } else if (msg.arg.channel === "books") {
      if (msg.action === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const d of msg.data as Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][]; ts: string }>) {
        applyLevels(this.bids, d.bids, 1);
        applyLevels(this.asks, d.asks, 1);
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
// BINANCE SPOT ADAPTER
// ============================================================
export class BinanceSpotAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-spot";
  private readonly BASE_WS = "wss://stream.binance.com:9443/ws";

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
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      this.ws!.send(JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: this.symbol } }));
      this.startPing(20_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
    } else if (msg.channel === "activeAssetCtx") {
      // Hyperliquid funds hourly, on the hour; oraclePx is its spot index.
      const { coin, ctx } = msg.data as { coin: string; ctx: { funding?: string; openInterest?: string; markPx?: string; oraclePx?: string } };
      if (coin !== this.symbol || !ctx) return;
      const hour = 3_600_000;
      this.emitDerivatives({
        openInterest: num(ctx.openInterest),
        fundingRate: num(ctx.funding),
        fundingIntervalHours: 1,
        nextFundingTime: Math.floor(Date.now() / hour) * hour + hour,
        markPrice: num(ctx.markPx),
        indexPrice: num(ctx.oraclePx),
      });
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
      this.ws!.send(JSON.stringify({ op: "subscribe", args: [{ instType, channel: "trade", instId }, { instType, channel: "books", instId }, { instType, channel: "ticker", instId }] }));
      this.startPing(25_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      // The first push is a snapshot of recent trades; skip it so old prints don't back-date the footprint.
      if (msg.action === "snapshot") return;
      for (const t of parseBitgetTrades(msg.data)) {
        const price = parseFloat(t.price), qty = parseFloat(t.size);
        this.emitTrade({ id: `bg-${t.tradeId}`, venue: this.venue, symbol: this.symbol, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side === "buy" ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.arg.channel === "ticker") {
      // holdingAmount is open interest in base units. Bitget has no public liquidation stream.
      for (const t of msg.data as Array<Record<string, string | undefined>>) {
        this.emitDerivatives({
          openInterest: num(t.holdingAmount),
          fundingRate: num(t.fundingRate),
          nextFundingTime: num(t.nextFundingTime),
          markPrice: num(t.markPrice),
          indexPrice: num(t.indexPrice),
          timestamp: num(t.ts),
        });
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
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      if (msg.action === "snapshot") return;
      for (const t of parseBitgetTrades(msg.data)) {
        const price = parseFloat(t.price), qty = parseFloat(t.size);
        this.emitTrade({ id: `bgs-${t.tradeId}`, venue: this.venue, symbol: this.symbol, timestamp: parseInt(t.ts), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side === "buy" ? "buy" : "sell", marketType: "spot" });
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
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      this.send({ jsonrpc: "2.0", id: this.reqId++, method: "public/subscribe", params: { channels: [`trades.${this.symbol}.100ms`, `book.${this.symbol}.none.20.100ms`, `ticker.${this.symbol}.100ms`] } });
      this.startPing(15_000);
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastHeartbeat = Date.now();
      // Any message after a transient error means the feed has recovered.
      if (this.status === "error" || this.status === "connecting") this.setStatus("live");
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
      for (const t of data as Array<{ trade_id: string; instrument_name: string; price: number; amount: number; direction: "buy" | "sell"; timestamp: number; liquidation?: "M" | "T" | "MT" }>) {
        const quantity = t.amount / t.price;
        this.emitTrade({ id: `db-${t.trade_id}`, venue: this.venue, symbol: t.instrument_name, timestamp: t.timestamp, localTimestamp: Date.now(), price: t.price, quantity, quoteVolume: t.price * quantity, side: t.direction, marketType: "perpetual" });
        if (t.liquidation) {
          // "T": the taker was liquidated, "M": the maker (opposite side), "MT": both.
          const takerSide: LiquidationSide = t.direction === "sell" ? "long" : "short";
          const makerSide: LiquidationSide = takerSide === "long" ? "short" : "long";
          const sides: LiquidationSide[] = t.liquidation === "M" ? [makerSide] : t.liquidation === "T" ? [takerSide] : [takerSide, makerSide];
          for (const side of sides) {
            this.emitLiquidation({ id: `dbl-${t.trade_id}-${side}`, symbol: t.instrument_name, timestamp: t.timestamp, price: t.price, quantity, side });
          }
        }
      }
    } else if (channel.startsWith("book.")) {
      // Grouped channel (book.X.none.20.100ms) sends full [price, amount] snapshots.
      // The raw channel sends {type, [action, price, amount]} deltas. Support both.
      const d = data as { type?: "snapshot" | "change"; bids: DeribitLevel[]; asks: DeribitLevel[] };
      const isDelta = d.bids.concat(d.asks).some((level) => typeof level[0] === "string");
      if (!isDelta || d.type === "snapshot") { this.bids.clear(); this.asks.clear(); }
      for (const [side, levels] of [[this.bids, d.bids], [this.asks, d.asks]] as const) {
        for (const level of levels) {
          const price = Number(level.length === 3 ? level[1] : level[0]);
          const amount = Number(level.length === 3 ? level[2] : level[1]);
          const removed = level.length === 3 && level[0] === "delete";
          // Inverse perpetuals quote size in USD; convert to base units.
          if (removed || !(amount > 0) || !(price > 0)) side.delete(price);
          else side.set(price, amount / price);
        }
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (channel.startsWith("ticker.")) {
      // Inverse perpetual: open interest is quoted in USD; funding is continuous (8h equivalent).
      const t = data as { open_interest?: number; funding_8h?: number; mark_price?: number; index_price?: number; timestamp?: number };
      const mark = num(t.mark_price);
      const oiUsd = num(t.open_interest);
      this.emitDerivatives({
        openInterest: mark && oiUsd ? oiUsd / mark : undefined,
        fundingRate: num(t.funding_8h),
        fundingIntervalHours: 8,
        markPrice: mark,
        indexPrice: num(t.index_price),
        timestamp: num(t.timestamp),
      });
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
    case "finnhub-forex": return new FinnhubForexAdapter(symbol);
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
