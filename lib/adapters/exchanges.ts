// ============================================================
// EXCHANGE ADAPTERS — All venues
// ============================================================

import { BaseExchangeAdapter, num } from "./base";
import type { Venue, LiquidationSide } from "@/lib/types/market";
import { FinnhubForexAdapter } from "./forex";
import { BOOK_DEPTH, emitBook } from "./book";
import { BybitFuturesAdapter, BybitSpotAdapter } from "./bybit";
import { OKXFuturesAdapter, OKXSpotAdapter } from "./okx";
import { BitgetFuturesAdapter, BitgetSpotAdapter } from "./bitget";
import { HyperliquidAdapter } from "./hyperliquid";

export { BOOK_DEPTH, BybitFuturesAdapter, BybitSpotAdapter, OKXFuturesAdapter, OKXSpotAdapter, BitgetFuturesAdapter, BitgetSpotAdapter, HyperliquidAdapter };

type DeribitLevel = [number, number] | [string, number, number];

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
