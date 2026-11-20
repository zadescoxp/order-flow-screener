// ============================================================
// KUCOIN ADAPTERS (Siebly `kucoin-api`, classic V1 public feeds)
//
// KuCoin issues a WebSocket token over REST, and its REST API sends no CORS
// headers, so the token (and futures contract details) come through this
// app's /api/kucoin route. Books use the level2Depth50 snapshot channels
// (full top-50 every 100ms), so no delta sequencing is needed.
// ============================================================

import type { WebsocketClient } from "kucoin-api";
import { num } from "./base";
import { emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

type KucoinWsKey = "spotPublicV1" | "futuresPublicV1";
type KucoinMessage = { type?: string; topic?: string; subject?: string; data?: Record<string, unknown> };
const OI_POLL_MS = 10_000;

/** BTCUSDT → BTC-USDT (spot) or XBTUSDTM (USDT-M perpetual). */
export function kucoinSymbol(symbol: string, futures: boolean): string {
  const s = symbol.toUpperCase();
  const base = s.replace(/-?USDTM?$/, "");
  if (!futures) return s.includes("-") ? s : `${base}-USDT`;
  return s.endsWith("USDTM") ? s : `${base === "BTC" ? "XBT" : base}USDTM`;
}

abstract class KucoinAdapter extends SieblyAdapter<WebsocketClient, string> {
  protected abstract readonly wsKey: KucoinWsKey;
  protected abstract readonly market: "spot" | "futures";
  protected abstract readonly depthTopic: string;

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("kucoin-api");
    const client = new WebsocketClient({ pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("kucoin-api"));
    // Fetch the public connection token through this app's server route.
    const market = this.market;
    (client as unknown as { getWSConnectionInfo: () => Promise<unknown> }).getWSConnectionInfo = async () => {
      const response = await fetch(`/api/kucoin?op=bullet&market=${market}`, { method: "POST" });
      if (!response.ok) throw new Error(`KuCoin token request failed (${response.status})`);
      return response.json();
    };
    return client;
  }

  protected bookTopics(): string[] { return [this.depthTopic]; }
  protected subscribeTopics(client: WebsocketClient, topics: string[]) { return client.subscribe(topics, this.wsKey); }
  protected unsubscribeTopics(client: WebsocketClient, topics: string[]) { return client.unsubscribe(topics, this.wsKey); }

  /** KuCoin acknowledges each subscribe with { type: "ack" }; errors arrive as exceptions. */
  protected ackOf(response: unknown): AckResult {
    return (response as { type?: string }).type === "ack" ? { ok: true } : null;
  }

  protected replaceBook(data: Record<string, unknown>, multiplier: number): void {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of (data.bids ?? []) as Array<[string | number, string | number]>) { const price = Number(p), qty = Number(q) * multiplier; if (price > 0 && qty > 0) this.bids.set(price, qty); }
    for (const [p, q] of (data.asks ?? []) as Array<[string | number, string | number]>) { const price = Number(p), qty = Number(q) * multiplier; if (price > 0 && qty > 0) this.asks.set(price, qty); }
    emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
  }
}

export class KucoinSpotAdapter extends KucoinAdapter {
  readonly venue: Venue = "kucoin-spot";
  protected readonly wsKey = "spotPublicV1";
  protected readonly market = "spot";

  constructor(symbol: string) { super(kucoinSymbol(symbol, false)); }

  protected get depthTopic(): string { return `/spotMarket/level2Depth50:${this.symbol}`; }
  protected topics(): string[] { return [`/market/match:${this.symbol}`, this.depthTopic]; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as KucoinMessage;
    if (msg.type !== "message" || !msg.data) return;
    if (msg.topic?.startsWith("/market/match:")) {
      const t = msg.data as { tradeId: string; symbol: string; side: "buy" | "sell"; size: string; price: string; time: string };
      const price = parseFloat(t.price), qty = parseFloat(t.size);
      this.emitTrade({ id: `kcs-${t.tradeId}`, venue: this.venue, symbol: t.symbol, timestamp: Math.round(Number(t.time) / 1e6), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "spot" });
    } else if (msg.topic === this.depthTopic) {
      this.replaceBook(msg.data, 1);
    }
  }
}

export class KucoinFuturesAdapter extends KucoinAdapter {
  readonly venue: Venue = "kucoin-futures";
  protected readonly wsKey = "futuresPublicV1";
  protected readonly market = "futures";
  private multiplier = 1;
  private fundingIntervalHours: number | undefined;
  private nextFundingTime: number | undefined;
  private oiTimer: ReturnType<typeof setInterval> | null = null;

  constructor(symbol: string) { super(kucoinSymbol(symbol, true)); }

  protected get depthTopic(): string { return `/contractMarket/level2Depth50:${this.symbol}`; }
  protected topics(): string[] {
    return [`/contractMarket/execution:${this.symbol}`, this.depthTopic, `/contract/instrument:${this.symbol}`];
  }

  /** Contract size first: trades and books are quoted in contracts. */
  protected async prepare(): Promise<void> {
    if (!(await this.loadContract())) this.reportError("Unable to load KuCoin contract size");
  }

  connect(): void {
    super.connect();
    if (!this.oiTimer) this.oiTimer = setInterval(() => void this.loadContract(), OI_POLL_MS);
  }

  disconnect(): void {
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.oiTimer = null;
    super.disconnect();
  }

  /** Contract details carry the size multiplier, open interest (contracts) and funding schedule. */
  private async loadContract(): Promise<boolean> {
    try {
      const response = await fetch(`/api/kucoin?op=contract&symbol=${encodeURIComponent(this.symbol)}`);
      if (!response.ok) return false;
      const { data } = (await response.json()) as { data?: Record<string, unknown> };
      if (!data) return false;
      const multiplier = num(data.multiplier as string);
      if (multiplier) this.multiplier = multiplier;
      const granularity = num(data.fundingRateGranularity as number);
      if (granularity) this.fundingIntervalHours = granularity / 3_600_000;
      this.nextFundingTime = num(data.nextFundingRateDateTime as number) ?? this.nextFundingTime;
      const oi = num(data.openInterest as string);
      this.emitDerivatives({
        openInterest: oi !== undefined ? oi * this.multiplier : undefined,
        fundingIntervalHours: this.fundingIntervalHours,
        nextFundingTime: this.nextFundingTime,
      });
      return true;
    } catch {
      return false;
    }
  }

  protected handleMessage(raw: unknown): void {
    const msg = raw as KucoinMessage;
    if (msg.type !== "message" || !msg.data) return;
    if (msg.topic?.startsWith("/contractMarket/execution:")) {
      const t = msg.data as { tradeId: string; symbol: string; side: "buy" | "sell"; size: number; price: string; ts: number };
      const price = parseFloat(t.price), qty = Number(t.size) * this.multiplier;
      this.emitTrade({ id: `kcf-${t.tradeId}`, venue: this.venue, symbol: t.symbol, timestamp: Math.round(Number(t.ts) / 1e6), localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.side, marketType: "perpetual" });
    } else if (msg.topic === this.depthTopic) {
      this.replaceBook(msg.data, this.multiplier);
    } else if (msg.topic?.startsWith("/contract/instrument:")) {
      if (msg.subject === "mark.index.price") {
        this.emitDerivatives({ markPrice: num(msg.data.markPrice as number), indexPrice: num(msg.data.indexPrice as number) });
      } else if (msg.subject === "funding.rate") {
        this.emitDerivatives({ fundingRate: num(msg.data.fundingRate as number), fundingIntervalHours: this.fundingIntervalHours, nextFundingTime: this.nextFundingTime });
      }
    }
  }
}
