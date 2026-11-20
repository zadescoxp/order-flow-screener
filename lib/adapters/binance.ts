// ============================================================
// BINANCE ADAPTERS (Siebly `binance`)
//
// USD-M futures: aggTrade, markPrice@1s and forceOrder live on Binance's
// /market route and partial depth on /public; the SDK's "usdm" key routes
// each topic to the right one. Open interest, the deep book snapshot for the
// heatmap and the funding interval come from REST.
// ============================================================

import type { WebsocketClient } from "binance";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult, type SieblyEventNames } from "./siebly";
import type { Venue } from "@/lib/types/market";

const REST = "https://fapi.binance.com";
const OI_POLL_MS = 5_000;
const DEEP_BOOK_POLL_MS = 5_000;

/* eslint-disable @typescript-eslint/no-explicit-any -- Binance payloads are flat, loosely typed objects */
type BinanceMessage = Record<string, any>;

abstract class BinanceAdapter extends SieblyAdapter<WebsocketClient, string> {
  protected abstract readonly wsKey: "main" | "usdm";
  protected abstract readonly depthTopic: string;
  /** binance emits raw stream data as "message" ("formattedMessage" when beautify is on). */
  protected readonly events: SieblyEventNames = { data: "message", reconnecting: "reconnecting" };

  constructor(symbol: string) { super(symbol.toUpperCase()); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("binance");
    return new WebsocketClient({ beautify: false, pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("binance"));
  }

  protected bookTopics(): string[] { return [this.depthTopic]; }
  protected subscribeTopics(client: WebsocketClient, topics: string[]) { return client.subscribe(topics, this.wsKey); }
  protected unsubscribeTopics(client: WebsocketClient, topics: string[]) { return client.unsubscribe(topics, this.wsKey); }

  /** Binance answers SUBSCRIBE with { result: null, id }; errors arrive as exceptions. */
  protected ackOf(response: unknown): AckResult {
    const res = response as { result?: unknown; id?: unknown };
    return "result" in (res ?? {}) && res.result === null && res.id !== undefined ? { ok: true } : null;
  }

  /** Partial depth: every message is a full top-N snapshot. */
  protected applyDepth(msg: BinanceMessage): void {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of (msg.b ?? msg.bids) as [string, string][]) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.bids.set(price, qty); }
    for (const [p, q] of (msg.a ?? msg.asks) as [string, string][]) { const price = parseFloat(p), qty = parseFloat(q); if (qty > 0) this.asks.set(price, qty); }
    emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
  }
}

export class BinanceSpotAdapter extends BinanceAdapter {
  readonly venue: Venue = "binance-spot";
  protected readonly wsKey = "main";
  protected get depthTopic(): string { return `${this.symbol.toLowerCase()}@depth20@100ms`; }

  protected topics(): string[] { return [`${this.symbol.toLowerCase()}@trade`, this.depthTopic]; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as BinanceMessage;
    if (msg.e === "trade") {
      const price = parseFloat(msg.p), qty = parseFloat(msg.q);
      this.emitTrade({ id: `bs-${msg.t}`, venue: this.venue, symbol: msg.s, timestamp: msg.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: msg.m ? "sell" : "buy", marketType: "spot", sequence: msg.t });
    } else if (msg.lastUpdateId && msg.bids && msg.asks) {
      this.applyDepth(msg);
    }
  }
}

export class BinanceFuturesAdapter extends BinanceAdapter {
  readonly venue: Venue = "binance-futures";
  protected readonly wsKey = "usdm";
  protected get depthTopic(): string { return `${this.symbol.toLowerCase()}@depth20@100ms`; }
  private oiTimer: ReturnType<typeof setInterval> | null = null;
  private deepTimer: ReturnType<typeof setInterval> | null = null;
  private deepBids = new Map<number, number>();
  private deepAsks = new Map<number, number>();
  private fundingIntervalHours: number | undefined;
  private active = false;

  protected topics(): string[] {
    const s = this.symbol.toLowerCase();
    return [`${s}@aggTrade`, `${s}@markPrice@1s`, `${s}@forceOrder`, this.depthTopic];
  }

  connect(): void {
    this.active = true;
    super.connect();
    this.startOpenInterestPolling();
    this.startDeepBookPolling();
    void this.loadFundingInterval();
  }

  disconnect(): void {
    this.active = false;
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.oiTimer = null;
    if (this.deepTimer) clearInterval(this.deepTimer);
    this.deepTimer = null;
    super.disconnect();
  }

  private startOpenInterestPolling(): void {
    if (this.oiTimer || typeof fetch === "undefined") return;
    const poll = async () => {
      try {
        const response = await fetch(`${REST}/fapi/v1/openInterest?symbol=${encodeURIComponent(this.symbol)}`);
        if (!response.ok) return;
        const body = (await response.json()) as { openInterest?: string; time?: number };
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
        const body = (await response.json()) as { bids?: [string, string][]; asks?: [string, string][] };
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
      const list = (await response.json()) as Array<{ symbol: string; fundingIntervalHours?: number }>;
      this.fundingIntervalHours = list.find((item) => item.symbol === this.symbol)?.fundingIntervalHours ?? 8;
    } catch {
      this.fundingIntervalHours = 8;
    }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as BinanceMessage;
    if (msg.e === "aggTrade") {
      const price = parseFloat(msg.p), qty = parseFloat(msg.q);
      this.emitTrade({ id: `bf-${msg.a}`, venue: this.venue, symbol: msg.s, timestamp: msg.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: msg.m ? "sell" : "buy", marketType: "perpetual", sequence: msg.a });
    } else if (msg.e === "depthUpdate" || (msg.lastUpdateId && msg.bids && msg.asks)) {
      this.applyDepth(msg);
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
}

