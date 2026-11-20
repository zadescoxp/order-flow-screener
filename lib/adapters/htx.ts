// ============================================================
// HTX ADAPTERS (Siebly `@siebly/htx-api`)
//
// HTX gzips every WebSocket frame; the SDK inflates them with the browser's
// DecompressionStream. Books use depth.step0 (full 150-level snapshots), so
// no delta sequencing is needed. Swap books are in contracts; the contract
// size, open interest and funding come from REST via this app's /api/htx
// route (HTX sends no CORS headers). This SDK emits data as "message".
// ============================================================

import type { WebsocketClient } from "@siebly/htx-api";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult, type SieblyEventNames } from "./siebly";
import type { Venue } from "@/lib/types/market";

type HtxWsKey = "spotPublic" | "linearSwapPublic";
type HtxMessage = { ch?: string; tick?: { id?: number; data?: unknown[]; bids?: Array<[number, number]>; asks?: Array<[number, number]> } };
const DERIVATIVES_POLL_MS = 10_000;

const htxBase = (symbol: string) => symbol.toUpperCase().replace(/-?USDT$/, "");

abstract class HtxAdapter extends SieblyAdapter<WebsocketClient, string> {
  protected readonly events: SieblyEventNames = { data: "message", reconnecting: "reconnecting" };
  protected abstract readonly wsKey: HtxWsKey;

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("@siebly/htx-api");
    return new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("htx-api"));
  }

  protected get tradeTopic(): string { return `market.${this.symbol}.trade.detail`; }
  protected get depthTopic(): string { return `market.${this.symbol}.depth.step0`; }
  protected topics(): string[] { return [this.tradeTopic, this.depthTopic]; }
  protected bookTopics(): string[] { return [this.depthTopic]; }
  protected subscribeTopics(client: WebsocketClient, topics: string[]) { return client.subscribe(topics as never, this.wsKey); }
  protected unsubscribeTopics(client: WebsocketClient, topics: string[]) { return client.unsubscribe(topics as never, this.wsKey); }

  /** HTX confirms with { status: "ok", subbed }; errors arrive as exceptions. */
  protected ackOf(response: unknown): AckResult {
    const res = response as { status?: string; subbed?: string };
    return res.status === "ok" && res.subbed ? { ok: true } : null;
  }

  protected replaceBook(tick: NonNullable<HtxMessage["tick"]>, multiplier: number): void {
    this.bids.clear();
    this.asks.clear();
    for (const [price, size] of tick.bids ?? []) if (price > 0 && size > 0) this.bids.set(price, size * multiplier);
    for (const [price, size] of tick.asks ?? []) if (price > 0 && size > 0) this.asks.set(price, size * multiplier);
    emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
  }
}

export class HtxSpotAdapter extends HtxAdapter {
  readonly venue: Venue = "htx-spot";
  protected readonly wsKey = "spotPublic";

  /** BTCUSDT → btcusdt. */
  constructor(symbol: string) { super(`${htxBase(symbol).toLowerCase()}usdt`); }

  protected handleMessage(raw: unknown): void {
    const msg = raw as HtxMessage;
    if (!msg.tick) return;
    if (msg.ch === this.tradeTopic) {
      for (const t of (msg.tick.data ?? []) as Array<{ tradeId: number; ts: number; amount: number; price: number; direction: "buy" | "sell" }>) {
        this.emitTrade({ id: `hxs-${t.tradeId}`, venue: this.venue, symbol: this.symbol, timestamp: t.ts, localTimestamp: Date.now(), price: t.price, quantity: t.amount, quoteVolume: t.price * t.amount, side: t.direction, marketType: "spot" });
      }
    } else if (msg.ch === this.depthTopic) {
      this.replaceBook(msg.tick, 1);
    }
  }
}

export class HtxFuturesAdapter extends HtxAdapter {
  readonly venue: Venue = "htx-futures";
  protected readonly wsKey = "linearSwapPublic";
  private contractSize = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** BTCUSDT → BTC-USDT. */
  constructor(symbol: string) { super(`${htxBase(symbol)}-USDT`); }

  /** Book sizes are in contracts: load the contract size before subscribing. */
  protected async prepare(): Promise<void> {
    const data = await this.rest<Array<{ contract_size?: number }>>("contract");
    const size = num(data?.[0]?.contract_size);
    if (size) this.contractSize = size;
    else this.reportError("Unable to load HTX contract size");
  }

  connect(): void {
    super.connect();
    if (!this.timer) {
      void this.pollDerivatives();
      this.timer = setInterval(() => void this.pollDerivatives(), DERIVATIVES_POLL_MS);
    }
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    super.disconnect();
  }

  private async rest<T>(op: "contract" | "oi" | "funding"): Promise<T | undefined> {
    try {
      const response = await fetch(`/api/htx?op=${op}&contract=${encodeURIComponent(this.symbol)}`);
      if (!response.ok) return undefined;
      const body = (await response.json()) as { status?: string; data?: T };
      return body.status === "ok" ? body.data : undefined;
    } catch {
      return undefined;
    }
  }

  /** Open interest (amount is in base units) and the current funding rate. */
  private async pollDerivatives(): Promise<void> {
    const [oi, funding] = await Promise.all([
      this.rest<Array<{ amount?: number }>>("oi"),
      this.rest<{ funding_rate?: string; funding_time?: string; next_funding_time?: string }>("funding"),
    ]);
    const next = num(funding?.funding_time);
    const after = num(funding?.next_funding_time);
    this.emitDerivatives({
      openInterest: num(oi?.[0]?.amount),
      fundingRate: num(funding?.funding_rate),
      nextFundingTime: next,
      fundingIntervalHours: next && after && after > next ? (after - next) / 3_600_000 : undefined,
    });
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as HtxMessage;
    if (!msg.tick) return;
    if (msg.ch === this.tradeTopic) {
      // Fill ids are the match id × 10^4 + index, beyond JS integer precision,
      // so they collide once parsed; the match id plus position is exact.
      const fills = (msg.tick.data ?? []) as Array<{ ts: number; amount: number; quantity?: number; price: number; direction: "buy" | "sell" }>;
      fills.forEach((t, i) => {
        // quantity is in base units; amount is contracts.
        const qty = t.quantity ?? t.amount * this.contractSize;
        this.emitTrade({ id: `hxf-${msg.tick?.id}-${i}`, venue: this.venue, symbol: this.symbol, timestamp: t.ts, localTimestamp: Date.now(), price: t.price, quantity: qty, quoteVolume: t.price * qty, side: t.direction, marketType: "perpetual" });
      });
    } else if (msg.ch === this.depthTopic) {
      this.replaceBook(msg.tick, this.contractSize);
    }
  }
}
