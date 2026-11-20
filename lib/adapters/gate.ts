// ============================================================
// GATE ADAPTERS (Siebly `gateio-api`)
//
// Order books use the snapshot channels (full top-20 every push), so no
// delta sequencing is needed. Perpetual sizes are in contracts; the
// contract's quanto_multiplier converts them to base units.
// ============================================================

import type { WebsocketClient } from "gateio-api";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

type GateTopic = { topic: string; payload: string[] };
type GateMessage = { channel?: string; event?: string; result?: unknown };
type GateWsKey = "spotV4" | "perpFuturesUSDTV4";

/** BTCUSDT → BTC_USDT; underscored ids pass through. */
export function gatePair(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.includes("_")) return s;
  return `${s.replace(/USDT$/, "")}_USDT`;
}

abstract class GateAdapter extends SieblyAdapter<WebsocketClient, GateTopic> {
  protected abstract readonly wsKey: GateWsKey;
  protected abstract readonly prefix: "spot" | "futures";

  constructor(symbol: string) { super(gatePair(symbol)); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("gateio-api");
    return new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("gateio-api"));
  }

  protected topic(channel: string, ...params: string[]): GateTopic {
    return { topic: `${this.prefix}.${channel}`, payload: [this.symbol, ...params] };
  }
  protected bookTopics(): GateTopic[] { return [this.topic("order_book", "20", this.prefix === "spot" ? "100ms" : "0")]; }
  protected subscribeTopics(client: WebsocketClient, topics: GateTopic[]) { return client.subscribe(topics, this.wsKey); }
  protected unsubscribeTopics(client: WebsocketClient, topics: GateTopic[]) { return client.unsubscribe(topics, this.wsKey); }

  protected ackOf(response: unknown): AckResult {
    const res = response as { event?: string; result?: { status?: string }; error?: { message?: string } };
    if (res.event !== "subscribe") return null;
    if (res.error) return { ok: false, reason: res.error.message ?? "unknown reason" };
    return res.result?.status === "success" ? { ok: true } : null;
  }

  protected replaceBook(bids: Array<[number, number]>, asks: Array<[number, number]>): void {
    this.bids.clear();
    this.asks.clear();
    for (const [price, size] of bids) if (price > 0 && size > 0) this.bids.set(price, size);
    for (const [price, size] of asks) if (price > 0 && size > 0) this.asks.set(price, size);
    emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
  }
}

export class GateSpotAdapter extends GateAdapter {
  readonly venue: Venue = "gate-spot";
  protected readonly wsKey = "spotV4";
  protected readonly prefix = "spot";

  protected topics(): GateTopic[] { return [this.topic("trades"), ...this.bookTopics()]; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as GateMessage;
    if (msg.channel === "spot.trades" && msg.event === "update") {
      const t = msg.result as { id: number; create_time_ms: string; side: "buy" | "sell"; currency_pair: string; amount: string; price: string };
      const price = parseFloat(t.price), qty = parseFloat(t.amount);
      this.emitTrade({ id: `gts-${t.id}`, venue: this.venue, symbol: t.currency_pair, timestamp: Math.round(Number(t.create_time_ms)), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "spot" });
    } else if (msg.channel === "spot.order_book" && msg.event === "update") {
      const book = msg.result as { s?: string; bids: [string, string][]; asks: [string, string][] };
      if (book.s && book.s !== this.symbol) return;
      this.replaceBook(book.bids.map(([p, q]) => [+p, +q]), book.asks.map(([p, q]) => [+p, +q]));
    }
  }
}

export class GateFuturesAdapter extends GateAdapter {
  readonly venue: Venue = "gate-futures";
  protected readonly wsKey = "perpFuturesUSDTV4";
  protected readonly prefix = "futures";
  private multiplier = 1;
  private fundingIntervalHours: number | undefined;
  private nextFundingTime: number | undefined;

  protected topics(): GateTopic[] {
    return [this.topic("trades"), ...this.bookTopics(), this.topic("tickers"), this.topic("public_liquidates")];
  }

  /** Contract size (base units per contract) and the funding schedule. */
  protected async prepare(): Promise<void> {
    try {
      const response = await fetch(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${encodeURIComponent(this.symbol)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const c = (await response.json()) as { quanto_multiplier?: string; funding_interval?: number; funding_next_apply?: number };
      const multiplier = Number(c.quanto_multiplier);
      if (multiplier > 0) this.multiplier = multiplier;
      if (c.funding_interval) this.fundingIntervalHours = c.funding_interval / 3600;
      if (c.funding_next_apply) this.nextFundingTime = c.funding_next_apply * 1000;
    } catch (error) {
      this.reportError(`Unable to load Gate contract size: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as GateMessage;
    if (msg.channel === "futures.trades" && msg.event === "update") {
      // size is signed contracts: positive = taker buy.
      for (const t of msg.result as Array<{ id: number; create_time_ms: number; contract: string; size: number; price: string }>) {
        const price = parseFloat(t.price), qty = Math.abs(t.size) * this.multiplier;
        this.emitTrade({ id: `gtf-${t.id}`, venue: this.venue, symbol: t.contract, timestamp: t.create_time_ms, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.size > 0 ? "buy" : "sell", marketType: "perpetual" });
      }
    } else if (msg.channel === "futures.order_book" && msg.event === "all") {
      const book = msg.result as { contract?: string; bids: Array<{ p: string; s: number }>; asks: Array<{ p: string; s: number }> };
      if (book.contract && book.contract !== this.symbol) return;
      const side = (levels: Array<{ p: string; s: number }>) => levels.map(({ p, s }) => [+p, s * this.multiplier] as [number, number]);
      this.replaceBook(side(book.bids), side(book.asks));
    } else if (msg.channel === "futures.tickers" && msg.event === "update") {
      for (const t of msg.result as Array<Record<string, string | number | undefined>>) {
        if (t.contract !== this.symbol) continue;
        const contracts = num(t.total_size);
        this.emitDerivatives({
          openInterest: contracts !== undefined ? contracts * this.multiplier : undefined,
          fundingRate: num(t.funding_rate),
          fundingIntervalHours: this.fundingIntervalHours,
          nextFundingTime: this.currentNextFunding(),
          markPrice: num(t.mark_price),
          indexPrice: num(t.index_price),
        });
      }
    } else if (msg.channel === "futures.public_liquidates" && msg.event === "update") {
      // A liquidation is a forced close: negative size sells, i.e. a long was liquidated.
      for (const l of msg.result as Array<{ contract: string; price: number | string; size: number; time_ms: number }>) {
        if (l.contract !== this.symbol) continue;
        this.emitLiquidation({ id: `gtl-${l.contract}-${l.time_ms}-${l.size}`, symbol: l.contract, timestamp: l.time_ms, price: Number(l.price), quantity: Math.abs(l.size) * this.multiplier, side: l.size < 0 ? "long" : "short" });
      }
    }
  }

  /** funding_next_apply is fetched once; roll it forward by the interval as it passes. */
  private currentNextFunding(): number | undefined {
    if (!this.nextFundingTime || !this.fundingIntervalHours) return this.nextFundingTime;
    const step = this.fundingIntervalHours * 3_600_000;
    while (this.nextFundingTime <= Date.now()) this.nextFundingTime += step;
    return this.nextFundingTime;
  }
}
