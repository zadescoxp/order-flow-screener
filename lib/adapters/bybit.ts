// ============================================================
// BYBIT ADAPTERS (Siebly `bybit-api`)
// ============================================================

import type { WebsocketClient } from "bybit-api";
import { num } from "./base";
import { applyLevels, emitBook } from "./book";
import { quietLogger, SieblyAdapter, type AckResult } from "./siebly";
import type { Venue } from "@/lib/types/market";

interface BybitTradeItem {
  T: number; S: "Buy" | "Sell"; v: string; p: string; i: string; s: string;
}
interface BybitDepthData {
  s: string; b: [string, string][]; a: [string, string][]; u: number; seq: number;
}

abstract class BybitAdapter extends SieblyAdapter<WebsocketClient, string> {
  protected abstract readonly category: "linear" | "spot";
  protected abstract readonly marketType: "perpetual" | "spot";
  protected abstract readonly tradeIdPrefix: string;
  protected abstract readonly bookTopicDepth: number;
  protected extraTopics(): string[] { return []; }
  private lastSeq = 0;

  constructor(symbol: string) { super(symbol.toUpperCase()); }

  protected async createClient(): Promise<WebsocketClient> {
    const { WebsocketClient } = await import("bybit-api");
    return new WebsocketClient({ market: "v5", pingInterval: 10_000, pongTimeout: 5_000, reconnectTimeout: 1_000 }, quietLogger("bybit-api"));
  }

  private get bookTopic(): string { return `orderbook.${this.bookTopicDepth}.${this.symbol}`; }
  protected topics(): string[] { return [`publicTrade.${this.symbol}`, this.bookTopic, ...this.extraTopics()]; }
  protected bookTopics(): string[] { return [this.bookTopic]; }
  protected subscribeTopics(client: WebsocketClient, topics: string[]) { return client.subscribeV5(topics, this.category); }
  protected unsubscribeTopics(client: WebsocketClient, topics: string[]) { return client.unsubscribeV5(topics, this.category); }

  protected ackOf(response: unknown): AckResult {
    const res = response as { op?: string; success?: boolean; ret_msg?: string };
    if (res.op !== "subscribe") return null;
    return res.success ? { ok: true } : { ok: false, reason: res.ret_msg ?? "unknown reason" };
  }

  protected onBookReset(): void { this.lastSeq = 0; }

  protected handleMessage(raw: unknown): void {
    const msg = raw as { topic?: string; type?: string; data: unknown };
    if (!msg.topic) return;
    if (msg.topic.startsWith("publicTrade.")) {
      for (const t of msg.data as BybitTradeItem[]) {
        const price = parseFloat(t.p), qty = parseFloat(t.v);
        this.emitTrade({ id: `${this.tradeIdPrefix}-${t.i}`, venue: this.venue, symbol: t.s, timestamp: t.T, localTimestamp: Date.now(), price, quantity: qty, quoteVolume: price * qty, side: t.S === "Buy" ? "buy" : "sell", marketType: this.marketType });
      }
    } else if (msg.topic.startsWith("orderbook.")) {
      const data = msg.data as BybitDepthData;
      if (msg.type === "snapshot") {
        this.bids.clear();
        this.asks.clear();
        this.awaitingSnapshot = false;
      } else if (this.awaitingSnapshot) {
        return;
      } else if (this.lastSeq > 0 && data.u > this.lastSeq + 1) {
        this.requestResubscribe();
        return;
      }
      applyLevels(this.bids, data.b, 1);
      applyLevels(this.asks, data.a, 1);
      this.lastSeq = data.u;
      emitBook(this, this.bids, this.asks, (b) => this.emitOrderBook(b));
    } else {
      this.handleExtraTopic?.(msg.topic, msg.data);
    }
  }

  protected handleExtraTopic?(topic: string, data: unknown): void;
}

export class BybitFuturesAdapter extends BybitAdapter {
  readonly venue: Venue = "bybit-futures";
  protected readonly category = "linear";
  protected readonly marketType = "perpetual";
  protected readonly tradeIdPrefix = "bb";
  protected readonly bookTopicDepth = 1000;

  protected extraTopics(): string[] { return [`tickers.${this.symbol}`, `allLiquidation.${this.symbol}`]; }

  protected handleExtraTopic(topic: string, data: unknown): void {
    if (topic.startsWith("tickers.")) {
      // Snapshot first, then deltas carrying only the fields that changed.
      const t = data as Record<string, string | undefined>;
      this.emitDerivatives({
        openInterest: num(t.openInterest),
        fundingRate: num(t.fundingRate),
        fundingIntervalHours: num(t.fundingIntervalHour),
        nextFundingTime: num(t.nextFundingTime),
        markPrice: num(t.markPrice),
        indexPrice: num(t.indexPrice),
      });
    } else if (topic.startsWith("allLiquidation.")) {
      // S is the liquidated position side: Buy = long position liquidated.
      for (const l of data as Array<{ T: number; s: string; S: "Buy" | "Sell"; v: string; p: string }>) {
        this.emitLiquidation({ id: `bbl-${l.s}-${l.T}-${l.S}-${l.v}`, symbol: l.s, timestamp: l.T, price: parseFloat(l.p), quantity: parseFloat(l.v), side: l.S === "Buy" ? "long" : "short" });
      }
    }
  }
}

export class BybitSpotAdapter extends BybitAdapter {
  readonly venue: Venue = "bybit-spot";
  protected readonly category = "spot";
  protected readonly marketType = "spot";
  protected readonly tradeIdPrefix = "bbs";
  protected readonly bookTopicDepth = 200;
}
