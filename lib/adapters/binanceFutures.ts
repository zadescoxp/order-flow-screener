// ============================================================
// BINANCE FUTURES ADAPTER
// Connects to Binance USD-M Futures WebSocket streams
// Provides: normalized trades, order book depth, liquidations,
// funding / mark / index (markPrice stream) and open interest (REST poll).
//
// Binance routes USD-M market streams by category: aggTrade, markPrice
// and forceOrder are served from /market, partial depth from /public.
// The legacy /ws route accepts subscriptions but delivers no data.
// ============================================================

import { BaseExchangeAdapter, num } from "./base";
import type {
  NormalizedOrderBook,
  OrderBookLevel,
  Venue,
} from "@/lib/types/market";

const MARKET_WS = "wss://fstream.binance.com/market/ws";
const PUBLIC_WS = "wss://fstream.binance.com/public/ws";
const REST = "https://fapi.binance.com";
const OI_POLL_MS = 5_000;
const DEEP_BOOK_POLL_MS = 5_000;

export class BinanceFuturesAdapter extends BaseExchangeAdapter {
  readonly venue: Venue = "binance-futures";
  private depthWs: WebSocket | null = null;
  private depthRetry: ReturnType<typeof setTimeout> | null = null;
  private depthAttempts = 0;
  private oiTimer: ReturnType<typeof setInterval> | null = null;
  private deepTimer: ReturnType<typeof setInterval> | null = null;
  private deepBids = new Map<number, number>();
  private deepAsks = new Map<number, number>();
  private fundingIntervalHours: number | undefined;
  private active = false;

  constructor(symbol: string) { super(symbol.toUpperCase()); }
  protected buildWsUrl(): string { return MARKET_WS; }

  connect(): void {
    this.active = true;
    super.connect();
    this.connectDepth();
    this.startOpenInterestPolling();
    this.startDeepBookPolling();
    void this.loadFundingInterval();
  }

  disconnect(): void {
    this.active = false;
    if (this.depthRetry) clearTimeout(this.depthRetry);
    this.depthRetry = null;
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.oiTimer = null;
    if (this.deepTimer) clearInterval(this.deepTimer);
    this.deepTimer = null;
    const depth = this.depthWs;
    this.depthWs = null;
    depth?.close();
    super.disconnect();
  }

  protected subscribe(): void {
    const s = this.symbol.toLowerCase();
    this.ws?.send(JSON.stringify({
      method: "SUBSCRIBE",
      params: [`${s}@aggTrade`, `${s}@markPrice@1s`, `${s}@forceOrder`],
      id: 1,
    }));
  }

  /** Depth lives on a separate route; it reconnects independently of the main socket. */
  private connectDepth(): void {
    if (!this.active || typeof WebSocket === "undefined") return;
    const ws = new WebSocket(PUBLIC_WS) as unknown as WebSocket;
    this.depthWs = ws;
    ws.onopen = () => {
      this.depthAttempts = 0;
      ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${this.symbol.toLowerCase()}@depth20@100ms`], id: 2 }));
    };
    ws.onmessage = (event: MessageEvent) => {
      try { this.handleMessage(JSON.parse(event.data as string)); } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      if (this.depthWs !== ws || !this.active) return;
      this.depthWs = null;
      const delay = Math.min(1000 * 2 ** this.depthAttempts++, 30_000);
      this.depthRetry = setTimeout(() => { this.depthRetry = null; this.connectDepth(); }, delay);
    };
  }

  private startOpenInterestPolling(): void {
    if (this.oiTimer || typeof fetch === "undefined") return;
    const poll = async () => {
      try {
        const response = await fetch(`${REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(this.symbol)}`);
        if (!response.ok) return;
        const body = await response.json() as { openInterest?: string; time?: number };
        if (this.active) this.emitDerivatives({ openInterest: num(body.openInterest), timestamp: body.time });
      } catch { /* transient network failure — next poll retries */ }
    };
    void poll();
    this.oiTimer = setInterval(poll, OI_POLL_MS);
  }

  /** The partial-depth stream stops at 20 levels; a REST snapshot gives the heatmap 1000. */
  private startDeepBookPolling(): void {
    if (this.deepTimer || typeof fetch === "undefined") return;
    const poll = async () => {
      try {
        const response = await fetch(`${REST}/fapi/v1/depth?symbol=${encodeURIComponent(this.symbol)}&limit=1000`);
        if (!response.ok) return;
        const body = await response.json() as { bids?: [string, string][]; asks?: [string, string][] };
        const toMap = (levels: [string, string][] = []) => new Map(levels.map(([p, q]) => [Number(p), Number(q)] as [number, number]).filter(([p, q]) => p > 0 && q > 0));
        if (!this.active) return;
        this.deepBids = toMap(body.bids);
        this.deepAsks = toMap(body.asks);
      } catch { /* next poll retries */ }
    };
    void poll();
    this.deepTimer = setInterval(poll, DEEP_BOOK_POLL_MS);
  }

  /** Live top-20 inside its own range, the REST snapshot beyond it. */
  depthSides(): { bids: ReadonlyMap<number, number>; asks: ReadonlyMap<number, number> } | null {
    if (!this.bids.size && !this.asks.size) return null;
    const merge = (live: Map<number, number>, deep: Map<number, number>, side: "bid" | "ask") => {
      if (!live.size) return deep;
      const prices = [...live.keys()];
      const edge = side === "bid" ? Math.min(...prices) : Math.max(...prices);
      const out = new Map(live);
      for (const [price, size] of deep) {
        if (side === "bid" ? price < edge : price > edge) out.set(price, size);
      }
      return out;
    };
    return { bids: merge(this.bids, this.deepBids, "bid"), asks: merge(this.asks, this.deepAsks, "ask") };
  }

  /** Most symbols fund every 8h; some use 4h or 1h, listed in fundingInfo. */
  private async loadFundingInterval(): Promise<void> {
    if (typeof fetch === "undefined") return;
    try {
      const response = await fetch(`${REST}/fapi/v1/fundingInfo`);
      if (!response.ok) return;
      const list = await response.json() as Array<{ symbol: string; fundingIntervalHours?: number }>;
      this.fundingIntervalHours = list.find((item) => item.symbol === this.symbol)?.fundingIntervalHours ?? 8;
    } catch {
      this.fundingIntervalHours = 8;
    }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (msg.e === "aggTrade") {
      const price = parseFloat(msg.p), qty = parseFloat(msg.q);
      this.emitTrade({ id: `bf-${msg.a}`, venue: this.venue, symbol: msg.s, timestamp: msg.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: msg.m ? "sell" : "buy", marketType: "perpetual", sequence: msg.a });
    } else if (msg.e === "depthUpdate" || (msg.lastUpdateId && msg.bids && msg.asks)) {
      // Partial depth: every message is a full top-N snapshot.
      this.bids.clear(); this.asks.clear();
      for (const [p, q] of msg.b ?? msg.bids) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
      for (const [p, q] of msg.a ?? msg.asks) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
      this.emitBook();
    } else if (msg.e === "markPriceUpdate") {
      this.emitDerivatives({
        markPrice: num(msg.p),
        indexPrice: num(msg.i),
        fundingRate: num(msg.r),
        nextFundingTime: num(msg.T),
        fundingIntervalHours: this.fundingIntervalHours,
        timestamp: num(msg.E),
      });
    } else if (msg.e === "forceOrder" && msg.o) {
      const o = msg.o;
      const price = num(o.ap) || num(o.p) || 0;
      const quantity = num(o.z) || num(o.q) || 0;
      // A forced SELL closes a long position.
      this.emitLiquidation({ id: `bfl-${o.s}-${o.T}-${o.S}`, symbol: o.s, timestamp: o.T, price, quantity, side: o.S === "SELL" ? "long" : "short" });
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

  protected sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: "LIST_SUBSCRIPTIONS", id: 3 }));
    }
  }
}
