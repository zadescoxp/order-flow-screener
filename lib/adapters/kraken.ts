// ============================================================
// KRAKEN ADAPTERS (Siebly `@siebly/kraken-api`)
//
// Spot: WebSocket v2 (trade, book) on BASE/USD, Kraken's deepest market.
// Perpetuals: Kraken Futures v1 multi-collateral PF_<BASE>USD contracts
// (contract size 1 base unit): trade (incl. liquidation fills), book with a
// per-product seq, and ticker for open interest, hourly funding, mark, index.
// This SDK emits data as "message" and drops as "reconnecting".
// ============================================================

import type { WebsocketClient, WSTopic } from "@siebly/kraken-api";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult, type SieblyEventNames } from "./siebly";
import type { Venue } from "@/lib/types/market";

type KrakenTopic = { topic: WSTopic; payload: Record<string, unknown> };
type KrakenWsKey = "spotPublicV2" | "derivativesPublicV1";

const krakenBase = (symbol: string) => symbol.toUpperCase().replace(/USDT?$/, "");

/** BTCUSDT → BTC/USD (spot v2) or PF_XBTUSD (futures). */
export function krakenSymbol(symbol: string, futures: boolean): string {
  const s = symbol.toUpperCase();
  if (s.includes("/") || s.startsWith("PF_")) return s;
  const base = krakenBase(s);
  return futures ? `PF_${base === "BTC" ? "XBT" : base}USD` : `${base}/USD`;
}

abstract class KrakenAdapter extends SieblyAdapter<WebsocketClient, KrakenTopic> {
  protected readonly events: SieblyEventNames = { data: "message", reconnecting: "reconnecting" };
  protected abstract readonly wsKey: KrakenWsKey;

  protected subscribeTopics(client: WebsocketClient, topics: KrakenTopic[]) { return client.subscribe(topics, this.wsKey); }
  protected unsubscribeTopics(client: WebsocketClient, topics: KrakenTopic[]) { return client.unsubscribe(topics, this.wsKey); }
}

export class KrakenSpotAdapter extends KrakenAdapter {
  readonly venue: Venue = "kraken-spot";
  protected readonly wsKey = "spotPublicV2";

  constructor(symbol: string) { super(krakenSymbol(symbol, false)); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("@siebly/kraken-api");
    return new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("kraken-api"));
  }

  private topic(channel: WSTopic, extra: Record<string, unknown> = {}): KrakenTopic {
    return { topic: channel, payload: { symbol: [this.symbol], ...extra } };
  }
  protected topics(): KrakenTopic[] { return [this.topic("trade", { snapshot: false }), ...this.bookTopics()]; }
  protected bookTopics(): KrakenTopic[] { return [this.topic("book", { depth: 100 })]; }

  protected ackOf(response: unknown): AckResult {
    const res = response as { method?: string; success?: boolean; error?: string };
    if (res.method !== "subscribe") return null;
    return res.success ? { ok: true } : { ok: false, reason: res.error ?? "unknown reason" };
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { channel?: string; type?: string; data?: unknown[] };
    if (msg.channel === "trade" && msg.type === "update") {
      for (const t of (msg.data ?? []) as Array<{ symbol: string; side: "buy" | "sell"; price: number; qty: number; trade_id: number; timestamp: string }>) {
        if (t.symbol !== this.symbol) continue;
        this.emitTrade({ id: `krs-${t.trade_id}`, venue: this.venue, symbol: t.symbol, timestamp: Date.parse(t.timestamp), localTimestamp: Date.now(), price: t.price, quantity: t.qty, quoteVolume: t.price * t.qty, side: t.side, marketType: "spot" });
      }
    } else if (msg.channel === "book") {
      const rows = (msg.data ?? []) as Array<{ symbol: string; bids: Array<{ price: number; qty: number }>; asks: Array<{ price: number; qty: number }> }>;
      if (msg.type === "snapshot") {
        this.bids.clear();
        this.asks.clear();
        this.awaitingSnapshot = false;
      } else if (this.awaitingSnapshot) {
        return;
      }
      for (const row of rows) {
        if (row.symbol !== this.symbol) continue;
        for (const { price, qty } of row.bids ?? []) { if (qty > 0) this.bids.set(price, qty); else this.bids.delete(price); }
        for (const { price, qty } of row.asks ?? []) { if (qty > 0) this.asks.set(price, qty); else this.asks.delete(price); }
      }
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    }
  }
}

export class KrakenFuturesAdapter extends KrakenAdapter {
  readonly venue: Venue = "kraken-futures";
  protected readonly wsKey = "derivativesPublicV1";
  private lastSeq = -1;

  constructor(symbol: string) { super(krakenSymbol(symbol, true)); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("@siebly/kraken-api");
    // The book and ticker stream continuously, and any message clears the
    // pong timer, so the timeout is generous for quieter contracts.
    const client = new WebsocketClient({ pingInterval: 10_000, pongTimeout: 15_000, reconnectTimeout: 1_000 }, quietLogger("kraken-api"));
    // Futures pings use ws.ping(), a Node-only protocol frame that throws in
    // the browser. Skip it: streamed data clears the pong timer instead, and
    // the heartbeat feed keeps the socket busy when the market is quiet.
    (client as unknown as { sendPingEvent: () => void }).sendPingEvent = () => {};
    return client;
  }

  private topic(feed: WSTopic): KrakenTopic { return { topic: feed, payload: { product_ids: [this.symbol] } }; }
  protected topics(): KrakenTopic[] {
    // heartbeat is a public Kraken Futures feed missing from the SDK's topic type.
    return [this.topic("trade"), ...this.bookTopics(), this.topic("ticker"), { topic: "heartbeat" as WSTopic, payload: {} }];
  }
  protected bookTopics(): KrakenTopic[] { return [this.topic("book")]; }

  protected ackOf(response: unknown): AckResult {
    const res = response as { event?: string; message?: string };
    if (res.event === "subscribed") return { ok: true };
    if (res.event === "error") return { ok: false, reason: res.message ?? "unknown reason" };
    return null;
  }

  protected onBookReset(): void { this.lastSeq = -1; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as Record<string, unknown> & { feed?: string; product_id?: string };
    if (msg.product_id && msg.product_id !== this.symbol) return;
    if (msg.feed === "trade") {
      const t = msg as unknown as { uid: string; side: "buy" | "sell"; type: string; time: number; qty: number; price: number };
      const price = Number(t.price), qty = Number(t.qty);
      // Kraken tags forced closes as type "liquidation"; side is the taker side.
      if (t.type === "liquidation") {
        this.emitLiquidation({ id: `krl-${t.uid}`, symbol: this.symbol, timestamp: t.time, price, quantity: qty, side: t.side === "sell" ? "long" : "short" });
      }
      this.emitTrade({ id: `krf-${t.uid}`, venue: this.venue, symbol: this.symbol, timestamp: t.time, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "perpetual" });
    } else if (msg.feed === "book_snapshot") {
      const book = msg as unknown as { seq: number; bids: Array<{ price: number; qty: number }>; asks: Array<{ price: number; qty: number }> };
      this.bids.clear();
      this.asks.clear();
      for (const { price, qty } of book.bids ?? []) if (qty > 0) this.bids.set(price, qty);
      for (const { price, qty } of book.asks ?? []) if (qty > 0) this.asks.set(price, qty);
      this.lastSeq = book.seq;
      this.awaitingSnapshot = false;
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (msg.feed === "book") {
      if (this.awaitingSnapshot) return;
      const u = msg as unknown as { seq: number; side: "buy" | "sell"; price: number; qty: number };
      if (this.lastSeq >= 0 && u.seq !== this.lastSeq + 1) {
        this.requestResubscribe();
        return;
      }
      this.lastSeq = u.seq;
      const side = u.side === "buy" ? this.bids : this.asks;
      if (u.qty > 0) side.set(u.price, u.qty);
      else side.delete(u.price);
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else if (msg.feed === "ticker") {
      // Kraken funds hourly; relative_funding_rate is the rate for that hour.
      this.emitDerivatives({
        openInterest: num(msg.openInterest as number),
        fundingRate: num(msg.relative_funding_rate as number),
        fundingIntervalHours: 1,
        nextFundingTime: num(msg.next_funding_rate_time as number),
        markPrice: num(msg.markPrice as number),
        indexPrice: num(msg.index as number),
      });
    }
  }
}
